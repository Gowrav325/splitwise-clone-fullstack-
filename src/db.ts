/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from "fs/promises";
import path from "path";

export interface DbState {
  users: { id: string; name: string; email: string; password_hash: string; created_at: string }[];
  groups: { id: string; name: string; created_by: string; created_at: string }[];
  group_members: { group_id: string; user_id: string; joined_at: string }[];
  expenses: { id: string; group_id: string; description: string; amount: number; created_by: string; split_type: string; created_at: string }[];
  expense_splits: { id: string; expense_id: string; user_id: string; amount: number; ratio: number }[];
  settlements: { id: string; group_id: string; payer_id: string; payee_id: string; amount: number; created_at: string }[];
  chats: { id: string; expense_id: string; user_id: string; message: string; created_at: string }[];
}

export class Database {
  private dbPath = path.join(process.cwd(), "splitwise_db.json");
  private state: DbState = {
    users: [],
    groups: [],
    group_members: [],
    expenses: [],
    expense_splits: [],
    settlements: [],
    chats: []
  };

  private writeQueue: Promise<void> = Promise.resolve();

  async load() {
    try {
      const data = await fs.readFile(this.dbPath, "utf-8");
      this.state = JSON.parse(data);
    } catch (e) {
      this.state = {
        users: [],
        groups: [],
        group_members: [],
        expenses: [],
        expense_splits: [],
        settlements: [],
        chats: []
      };
      await this.save();
    }
  }

  async save() {
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        await fs.writeFile(this.dbPath, JSON.stringify(this.state, null, 2), "utf-8");
      } catch (err) {
        console.error("Failed to write to database file:", err);
      }
    });
    await this.writeQueue;
  }

  async exec(sql: string): Promise<void> {
    // Structural updates (CREATE TABLE/INDEX) are handled programmatically in our JS state.
    // So exec is a helper no-op.
    return;
  }

  async get(sql: string, params: any[] = []): Promise<any> {
    const norm = sql.trim().replace(/\s+/g, " ");

    // 1. SELECT COUNT(*) as count FROM users
    if (/select\s+count\(\*\)\s+as\s+count\s+from\s+users/i.test(norm)) {
      return { count: this.state.users.length };
    }

    // 2. SELECT id FROM users WHERE email = ?
    if (/select\s+id\s+from\s+users\s+where\s+email\s*=\s*\?/i.test(norm)) {
      const email = params[0]?.toLowerCase().trim();
      const user = this.state.users.find(u => u.email.toLowerCase().trim() === email);
      return user ? { id: user.id } : undefined;
    }

    // 3. SELECT * FROM users WHERE email = ?
    if (/select\s+\*\s+from\s+users\s+where\s+email\s*=\s*\?/i.test(norm)) {
      const email = params[0]?.toLowerCase().trim();
      const user = this.state.users.find(u => u.email.toLowerCase().trim() === email);
      return user ? { ...user } : undefined;
    }

    // 4. SELECT * FROM users WHERE id = ?
    if (/select\s+\*\s+from\s+users\s+where\s+id\s*=\s*\?/i.test(norm)) {
      const id = params[0];
      const user = this.state.users.find(u => u.id === id);
      return user ? { ...user } : undefined;
    }

    // 5. SELECT * FROM groups WHERE id = ?
    if (/select\s+\*\s+from\s+groups\s+where\s+id\s*=\s*\?/i.test(norm)) {
      const id = params[0];
      const group = this.state.groups.find(g => g.id === id);
      return group ? { ...group } : undefined;
    }

    // 6. SELECT * FROM group_members WHERE group_id = ? AND user_id = ?
    if (/select\s+\*\s+from\s+group_members\s+where\s+group_id\s*=\s*\?\s+and\s+user_id\s*=\s*\?/i.test(norm)) {
      const [groupId, userId] = params;
      const member = this.state.group_members.find(gm => gm.group_id === groupId && gm.user_id === userId);
      return member ? { ...member } : undefined;
    }

    console.warn("[MOCK DB] Unhandled GET query:", sql, params);
    return undefined;
  }

  async all(sql: string, params: any[] = []): Promise<any[]> {
    const norm = sql.trim().replace(/\s+/g, " ");

    // 1. SELECT id, name, email FROM users ORDER BY name ASC
    if (/select\s+id,\s*name,\s*email\s+from\s+users\s+order\s+by\s+name\s+asc/i.test(norm)) {
      return [...this.state.users]
        .map(u => ({ id: u.id, name: u.name, email: u.email }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    // 2. JOIN group_members gm ON g.id = gm.group_id ... WHERE gm.user_id = ? ORDER BY g.created_at DESC
    if (/from\s+groups\s+g\s+join\s+group_members\s+gm/i.test(norm) && /gm\.user_id\s*=\s*\?/i.test(norm)) {
      const userId = params[0];
      const membershipGroupIds = this.state.group_members
        .filter(gm => gm.user_id === userId)
        .map(gm => gm.group_id);

      const result = this.state.groups
        .filter(g => membershipGroupIds.includes(g.id))
        .map(g => {
          const creator = this.state.users.find(u => u.id === g.created_by);
          const membersCount = this.state.group_members.filter(gm => gm.group_id === g.id).length;
          return {
            id: g.id,
            name: g.name,
            created_by: g.created_by,
            created_at: g.created_at,
            creator_name: creator ? creator.name : null,
            members_count: membersCount
          };
        });

      return result.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }

    // 3. SELECT u.id, u.name, u.email, gm.joined_at FROM group_members gm JOIN users u ON gm.user_id = u.id WHERE gm.group_id = ? ORDER BY u.name ASC
    if (/from\s+group_members\s+gm\s+join\s+users\s+u/i.test(norm) && /gm\.group_id\s*=\s*\?/i.test(norm)) {
      const groupId = params[0];
      const gmList = this.state.group_members.filter(gm => gm.group_id === groupId);
      const result = gmList.map(gm => {
        const u = this.state.users.find(user => user.id === gm.user_id);
        return {
          id: u?.id || gm.user_id,
          name: u?.name || "Unknown User",
          email: u?.email || "",
          joined_at: gm.joined_at
        };
      });

      if (/order\s+by\s+u\.name\s+asc/i.test(norm)) {
        return result.sort((a, b) => a.name.localeCompare(b.name));
      }
      return result;
    }

    // 4. SELECT e.*, u.name as payer_name FROM expenses e JOIN users u ON e.created_by = u.id WHERE e.group_id = ? ORDER BY e.created_at DESC
    if (/from\s+expenses\s+e\s+join\s+users\s+u/i.test(norm) && /e\.group_id\s*=\s*\?/i.test(norm)) {
      const groupId = params[0];
      const expList = this.state.expenses.filter(e => e.group_id === groupId);
      const result = expList.map(e => {
        const u = this.state.users.find(user => user.id === e.created_by);
        return {
          ...e,
          payer_name: u ? u.name : "Unknown User"
        };
      });

      return result.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }

    // 5. SELECT es.*, u.name as user_name FROM expense_splits es JOIN users u ON es.user_id = u.id WHERE es.expense_id = ?
    if (/from\s+expense_splits\s+es\s+join\s+users\s+u/i.test(norm) && /es\.expense_id\s*=\s*\?/i.test(norm)) {
      const expenseId = params[0];
      const splitList = this.state.expense_splits.filter(es => es.expense_id === expenseId);
      return splitList.map(es => {
        const u = this.state.users.find(user => user.id === es.user_id);
        return {
          ...es,
          user_name: u ? u.name : "Unknown User"
        };
      });
    }

    // 6. SELECT s.*, u1.name as payer_name, u2.name as payee_name FROM settlements s JOIN users u1 ... ORDER BY s.created_at DESC
    if (/from\s+settlements\s+s\s+join\s+users\s+u1/i.test(norm) && /s\.group_id\s*=\s*\?/i.test(norm)) {
      const groupId = params[0];
      const stList = this.state.settlements.filter(s => s.group_id === groupId);
      const result = stList.map(s => {
        const u1 = this.state.users.find(user => user.id === s.payer_id);
        const u2 = this.state.users.find(user => user.id === s.payee_id);
        return {
          ...s,
          payer_name: u1 ? u1.name : "Unknown User",
          payee_name: u2 ? u2.name : "Unknown User"
        };
      });

      return result.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }

    // 7. SELECT id, created_by, amount FROM expenses WHERE group_id = ?
    if (/select\s+id,\s*created_by,\s*amount\s+from\s+expenses\s+where\s+group_id\s*=\s*\?/i.test(norm)) {
      const groupId = params[0];
      return this.state.expenses
        .filter(e => e.group_id === groupId)
        .map(e => ({ id: e.id, created_by: e.created_by, amount: e.amount }));
    }

    // 8. SELECT user_id, amount FROM expense_splits WHERE expense_id = ?
    if (/select\s+user_id,\s*amount\s+from\s+expense_splits\s+where\s+expense_id\s*=\s*\?/i.test(norm)) {
      const expenseId = params[0];
      return this.state.expense_splits
        .filter(es => es.expense_id === expenseId)
        .map(es => ({ user_id: es.user_id, amount: es.amount }));
    }

    // 9. SELECT payer_id, payee_id, amount FROM settlements WHERE group_id = ?
    if (/select\s+payer_id,\s*payee_id,\s*amount\s+from\s+settlements\s+where\s+group_id\s*=\s*\?/i.test(norm)) {
      const groupId = params[0];
      return this.state.settlements
        .filter(s => s.group_id === groupId)
        .map(s => ({ payer_id: s.payer_id, payee_id: s.payee_id, amount: s.amount }));
    }

    // 10. SELECT c.*, u.name as user_name, u.email as user_email FROM chats c JOIN users u ON c.user_id = u.id WHERE c.expense_id = ? ORDER BY c.created_at ASC
    if (/from\s+chats\s+c\s+join\s+users\s+u/i.test(norm) && /c\.expense_id\s*=\s*\?/i.test(norm)) {
      const expenseId = params[0];
      const chatsList = this.state.chats.filter(c => c.expense_id === expenseId);
      const result = chatsList.map(c => {
        const u = this.state.users.find(user => user.id === c.user_id);
        return {
          ...c,
          user_name: u ? u.name : "Unknown User",
          user_email: u ? u.email : ""
        };
      });

      return result.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    console.warn("[MOCK DB] Unhandled ALL query:", sql, params);
    return [];
  }

  async run(sql: string, params: any[] = []): Promise<{ lastID?: any; changes?: number }> {
    const norm = sql.trim().replace(/\s+/g, " ");

    if (/^(begin|commit|rollback)/i.test(norm)) {
      return { changes: 1 };
    }

    // INSERT INTO users
    if (/insert\s+into\s+users/i.test(norm)) {
      const [id, name, email, password_hash, created_at] = params;
      if (this.state.users.some(u => u.email.toLowerCase().trim() === email.toLowerCase().trim())) {
        throw new Error("UNIQUE constraint failed: users.email");
      }
      this.state.users.push({ id, name, email, password_hash, created_at });
      await this.save();
      return { lastID: id, changes: 1 };
    }

    // INSERT INTO groups
    if (/insert\s+into\s+groups/i.test(norm)) {
      const [id, name, created_by, created_at] = params;
      this.state.groups.push({ id, name, created_by, created_at });
      await this.save();
      return { lastID: id, changes: 1 };
    }

    // INSERT INTO group_members
    if (/insert\s+(or\s+ignore\s+)?into\s+group_members/i.test(norm)) {
      const [group_id, user_id, joined_at] = params;
      const exists = this.state.group_members.some(gm => gm.group_id === group_id && gm.user_id === user_id);
      if (!exists) {
        this.state.group_members.push({ group_id, user_id, joined_at });
        await this.save();
      }
      return { changes: exists ? 0 : 1 };
    }

    // INSERT INTO expenses
    if (/insert\s+into\s+expenses/i.test(norm)) {
      const [id, group_id, description, amount, created_by, split_type, created_at] = params;
      this.state.expenses.push({ id, group_id, description, amount: parseFloat(amount), created_by, split_type, created_at });
      await this.save();
      return { lastID: id, changes: 1 };
    }

    // INSERT INTO expense_splits
    if (/insert\s+into\s+expense_splits/i.test(norm)) {
      const [id, expense_id, user_id, amount, ratio] = params;
      this.state.expense_splits.push({ id, expense_id, user_id, amount: parseFloat(amount), ratio: parseFloat(ratio) });
      await this.save();
      return { lastID: id, changes: 1 };
    }

    // INSERT INTO settlements
    if (/insert\s+into\s+settlements/i.test(norm)) {
      const [id, group_id, payer_id, payee_id, amount, created_at] = params;
      this.state.settlements.push({ id, group_id, payer_id, payee_id, amount: parseFloat(amount), created_at });
      await this.save();
      return { lastID: id, changes: 1 };
    }

    // INSERT INTO chats
    if (/insert\s+into\s+chats/i.test(norm)) {
      const [id, expense_id, user_id, message, created_at] = params;
      this.state.chats.push({ id, expense_id, user_id, message, created_at });
      await this.save();
      return { lastID: id, changes: 1 };
    }

    // DELETE FROM group_members WHERE group_id = ? AND user_id = ?
    if (/delete\s+from\s+group_members\s+where\s+group_id\s*=\s*\?\s+and\s+user_id\s*=\s*\?/i.test(norm)) {
      const [groupId, userId] = params;
      const initialLen = this.state.group_members.length;
      this.state.group_members = this.state.group_members.filter(gm => !(gm.group_id === groupId && gm.user_id === userId));
      await this.save();
      return { changes: initialLen - this.state.group_members.length };
    }

    // DELETE FROM expenses WHERE id = ?
    if (/delete\s+from\s+expenses\s+where\s+id\s*=\s*\?/i.test(norm)) {
      const id = params[0];
      const initialLen = this.state.expenses.length;
      this.state.expenses = this.state.expenses.filter(e => e.id !== id);
      // Cascade delete splits and comments
      this.state.expense_splits = this.state.expense_splits.filter(es => es.expense_id !== id);
      this.state.chats = this.state.chats.filter(c => c.expense_id !== id);
      await this.save();
      return { changes: initialLen - this.state.expenses.length };
    }

    console.warn("[MOCK DB] Unhandled RUN query:", sql, params);
    return { changes: 0 };
  }
}

let dbInstance: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!dbInstance) {
    dbInstance = new Database();
    await dbInstance.load();
    await bootstrapSchema(dbInstance);
  }
  return dbInstance;
}

async function bootstrapSchema(db: Database) {
  // Check if users table/array is empty
  const countObj = await db.get("SELECT COUNT(*) as count FROM users");
  if (!countObj || countObj.count === 0) {
    await seedDemoData(db);
  }
}

async function seedDemoData(db: Database) {
  console.log("Seeding Splitwise demo database...");
  
  // Seed Users
  const users = [
    { id: "u-1", name: "Alice Smith", email: "alice@example.com", password_hash: "demo", created_at: new Date().toISOString() },
    { id: "u-2", name: "Bob Johnson", email: "bob@example.com", password_hash: "demo", created_at: new Date().toISOString() },
    { id: "u-3", name: "Charlie Brown", email: "charlie@example.com", password_hash: "demo", created_at: new Date().toISOString() },
    { id: "u-4", name: "Diana Prince", email: "diana@example.com", password_hash: "demo", created_at: new Date().toISOString() }
  ];

  for (const u of users) {
    await db.run(
      "INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
      [u.id, u.name, u.email, u.password_hash, u.created_at]
    );
  }

  // Seed Groups
  const groups = [
    { id: "g-1", name: "Apartment 4B", created_by: "u-1", created_at: new Date().toISOString() },
    { id: "g-2", name: "Weekend Trip to Tahoe", created_by: "u-2", created_at: new Date().toISOString() }
  ];

  for (const g of groups) {
    await db.run(
      "INSERT INTO groups (id, name, created_by, created_at) VALUES (?, ?, ?, ?)",
      [g.id, g.name, g.created_by, g.created_at]
    );
  }

  // Seed Group Members
  const members = [
    // Apartment 4B members: Alice, Bob, Charlie
    { group_id: "g-1", user_id: "u-1", joined_at: new Date().toISOString() },
    { group_id: "g-1", user_id: "u-2", joined_at: new Date().toISOString() },
    { group_id: "g-1", user_id: "u-3", joined_at: new Date().toISOString() },
    
    // Weekend Trip members: Alice, Bob, Charlie, Diana
    { group_id: "g-2", user_id: "u-1", joined_at: new Date().toISOString() },
    { group_id: "g-2", user_id: "u-2", joined_at: new Date().toISOString() },
    { group_id: "g-2", user_id: "u-3", joined_at: new Date().toISOString() },
    { group_id: "g-2", user_id: "u-4", joined_at: new Date().toISOString() }
  ];

  for (const m of members) {
    await db.run(
      "INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)",
      [m.group_id, m.user_id, m.joined_at]
    );
  }

  // Seed Expenses
  // 1. Equal Split: Rent and utilities inside Apartment 4B - Alice paid $1200
  const exp1Id = "e-1";
  await db.run(
    "INSERT INTO expenses (id, group_id, description, amount, created_by, split_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [exp1Id, "g-1", "Monthly Rent Check", 1200.0, "u-1", "equal", new Date().toISOString()]
  );
  // Rent split equally among 3 members: $400 each
  for (const uid of ["u-1", "u-2", "u-3"]) {
    await db.run(
      "INSERT INTO expense_splits (id, expense_id, user_id, amount, ratio) VALUES (?, ?, ?, ?, ?)",
      [`s-1-${uid}`, exp1Id, uid, 400.0, 1.0]
    );
  }

  // 2. Unequal Split: Dinner - Bob paid $100.
  // Splits: Alice: $50, Bob: $30, Charlie: $20.
  const exp2Id = "e-2";
  await db.run(
    "INSERT INTO expenses (id, group_id, description, amount, created_by, split_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [exp2Id, "g-1", "Welcome Dinner", 100.0, "u-2", "unequal", new Date().toISOString()]
  );
  const DinnerSplits = [
    { uid: "u-1", amt: 50.0 },
    { uid: "u-2", amt: 30.0 },
    { uid: "u-3", amt: 20.0 }
  ];
  for (const s of DinnerSplits) {
    await db.run(
      "INSERT INTO expense_splits (id, expense_id, user_id, amount, ratio) VALUES (?, ?, ?, ?, ?)",
      [`s-2-${s.uid}`, exp2Id, s.uid, s.amt, s.amt]
    );
  }

  // 3. Share Split: Tahoe Cabin Rent - Diana paid $800.
  // Shares: Alice 1, Bob 2, Charlie 1, Diana 1 (Total shares = 5 -> $160 per share)
  const exp3Id = "e-3";
  await db.run(
    "INSERT INTO expenses (id, group_id, description, amount, created_by, split_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [exp3Id, "g-2", "Tahoe Cabin Lodging", 800.0, "u-4", "shares", new Date().toISOString()]
  );
  const cabinShares = [
    { uid: "u-1", shares: 1.0, amt: 160.0 },
    { uid: "u-2", shares: 2.0, amt: 320.0 },
    { uid: "u-3", shares: 1.0, amt: 160.0 },
    { uid: "u-4", shares: 1.0, amt: 160.0 }
  ];
  for (const s of cabinShares) {
    await db.run(
      "INSERT INTO expense_splits (id, expense_id, user_id, amount, ratio) VALUES (?, ?, ?, ?, ?)",
      [`s-3-${s.uid}`, exp3Id, s.uid, s.amt, s.shares]
    );
  }

  // Seed standard chat comments
  const chats = [
    { id: "c-1", expense_id: "e-1", user_id: "u-2", message: "Thanks for wire transfer, Alice! Added my electricity share soon.", created_at: new Date(Date.now() - 3600000).toISOString() },
    { id: "c-2", expense_id: "e-1", user_id: "u-1", message: "No worries! Pay whenever you are ready.", created_at: new Date().toISOString() },
    { id: "c-3", expense_id: "e-2", user_id: "u-3", message: "Awesome food! Thanks Bob for booking.", created_at: new Date().toISOString() }
  ];

  for (const c of chats) {
    await db.run(
      "INSERT INTO chats (id, expense_id, user_id, message, created_at) VALUES (?, ?, ?, ?, ?)",
      [c.id, c.expense_id, c.user_id, c.message, c.created_at]
    );
  }

  console.log("Demo database successfully seeded.");
}
