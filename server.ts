/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express, { Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import path from "path";
import { getDb } from "./src/db";
import { GoogleGenAI, Type } from "@google/genai";

// Define custom Extend Request Typings
interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
  };
}

const JWT_SECRET = process.env.JWT_SECRET || "splitwise_clone_secured_key_8899";

async function run() {
  const app = express();
  const PORT = 3000;

  // Initialize DB immediately on boot
  await getDb();

  // Basic Middlewares
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.use(cookieParser());

  // --- AUTHENTICATION MIDDLEWARE ---
  function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    const token = req.cookies.token;
    if (!token) {
      res.status(401).json({ error: "Unauthorized. Please log in." });
      return;
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { id: string; email: string; name: string };
      req.user = decoded;
      next();
    } catch (err) {
      res.status(401).json({ error: "Session expired. Please log in again." });
    }
  }

  // --- API ROUTES ---

  // 1. Auth Endpoint: Sign up
  app.post("/api/auth/signup", async (req: Request, res: Response) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      res.status(400).json({ error: "Name, email, and password are required." });
      return;
    }

    try {
      const db = await getDb();
      // Check if user already exists
      const existing = await db.get("SELECT id FROM users WHERE email = ?", [email.toLowerCase().trim()]);
      if (existing) {
        res.status(400).json({ error: "Email already registered." });
        return;
      }

      const id = "u-" + Math.random().toString(36).substr(2, 9);
      const createdAt = new Date().toISOString();

      await db.run(
        "INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
        [id, name.trim(), email.toLowerCase().trim(), password, createdAt]
      );

      // Issue JWT token
      const tokenPayload = { id, email: email.toLowerCase().trim(), name };
      const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: "7d" });

      res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      res.json({ user: tokenPayload });
    } catch (err: any) {
      res.status(500).json({ error: "Database error: " + err.message });
    }
  });

  // 2. Auth Endpoint: Log in
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required." });
      return;
    }

    try {
      const db = await getDb();
      const user = await db.get("SELECT * FROM users WHERE email = ?", [email.toLowerCase().trim()]);
      if (!user) {
        res.status(400).json({ error: "Invalid email or password." });
        return;
      }

      // Password checking for simple demo context
      if (user.password_hash !== "demo" && user.password_hash !== password) {
        res.status(400).json({ error: "Invalid email or password." });
        return;
      }

      const tokenPayload = { id: user.id, email: user.email, name: user.name };
      const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: "7d" });

      res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      res.json({ user: tokenPayload });
    } catch (err: any) {
      res.status(500).json({ error: "Database error: " + err.message });
    }
  });

  // 3. Auth Endpoint: Logout
  app.post("/api/auth/logout", (req: Request, res: Response) => {
    res.clearCookie("token");
    res.json({ success: true });
  });

  // 4. Auth Endpoint: Get Current User Session Info
  app.get("/api/auth/me", (req: AuthenticatedRequest, res: Response) => {
    const token = req.cookies.token;
    if (!token) {
      res.status(401).json({ error: "Not logged in" });
      return;
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { id: string; email: string; name: string };
      res.json({ user: decoded });
    } catch (err) {
      res.status(401).json({ error: "Session expired" });
    }
  });

  // 5. Auth Endpoint: Get users list (to invite/look up)
  app.get("/api/auth/users", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = await getDb();
      const users = await db.all("SELECT id, name, email FROM users ORDER BY name ASC");
      res.json({ users });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- GROUP ROUTES ---

  // 6. Groups List (groups user belongs to)
  app.get("/api/groups", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    try {
      const db = await getDb();
      const groups = await db.all(`
        SELECT g.*, u.name as creator_name,
        (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as members_count
        FROM groups g
        JOIN group_members gm ON g.id = gm.group_id
        LEFT JOIN users u ON g.created_by = u.id
        WHERE gm.user_id = ?
        ORDER BY g.created_at DESC
      `, [userId]);

      res.json({ groups });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 7. Create Group
  app.post("/api/groups", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { name } = req.body;
    const userId = req.user!.id;

    if (!name || !name.trim()) {
      res.status(400).json({ error: "Group name is required." });
      return;
    }

    try {
      const db = await getDb();
      const groupId = "g-" + Math.random().toString(36).substr(2, 9);
      const now = new Date().toISOString();

      // Begin atomic transaction to insert group and add creator as member
      await db.run("BEGIN TRANSACTION");
      
      await db.run(
        "INSERT INTO groups (id, name, created_by, created_at) VALUES (?, ?, ?, ?)",
        [groupId, name.trim(), userId, now]
      );

      await db.run(
        "INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)",
        [groupId, userId, now]
      );

      await db.run("COMMIT");

      res.json({ groupId, name: name.trim() });
    } catch (err: any) {
      try {
        const db = await getDb();
        await db.run("ROLLBACK");
      } catch (rErr) {}
      res.status(500).json({ error: "Failed to create group: " + err.message });
    }
  });

  // 8. Get Group Details & Group Members
  app.get("/api/groups/:groupId", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { groupId } = req.params;
    try {
      const db = await getDb();
      const group = await db.get("SELECT * FROM groups WHERE id = ?", [groupId]);
      if (!group) {
        res.status(404).json({ error: "Group not found." });
        return;
      }

      const members = await db.all(`
        SELECT u.id, u.name, u.email, gm.joined_at
        FROM group_members gm
        JOIN users u ON gm.user_id = u.id
        WHERE gm.group_id = ?
        ORDER BY u.name ASC
      `, [groupId]);

      res.json({ group, members });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 9. Add Member to Group (via userId or email lookup)
  app.post("/api/groups/:groupId/members", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { groupId } = req.params;
    const { email, userIdToAdd } = req.body;

    if (!email && !userIdToAdd) {
      res.status(400).json({ error: "Either email or user ID is required." });
      return;
    }

    try {
      const db = await getDb();
      let targetUser: any = null;

      if (userIdToAdd) {
        targetUser = await db.get("SELECT * FROM users WHERE id = ?", [userIdToAdd]);
      } else {
        targetUser = await db.get("SELECT * FROM users WHERE email = ?", [email.toLowerCase().trim()]);
      }

      if (!targetUser) {
        res.status(404).json({ error: "User not found." });
        return;
      }

      // Check if already member
      const existing = await db.get(
        "SELECT * FROM group_members WHERE group_id = ? AND user_id = ?",
        [groupId, targetUser.id]
      );

      if (existing) {
        res.status(400).json({ error: "User is already a member of this group." });
        return;
      }

      const now = new Date().toISOString();
      await db.run(
        "INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)",
        [groupId, targetUser.id, now]
      );

      res.json({ success: true, user: { id: targetUser.id, name: targetUser.name, email: targetUser.email } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 10. Remove Member from Group
  app.delete("/api/groups/:groupId/members/:memberId", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { groupId, memberId } = req.params;

    try {
      const db = await getDb();
      // Keep safety: Do not remove if member still has outstanding balance/debts, or let them remove
      // First, remove from group_members
      await db.run(
        "DELETE FROM group_members WHERE group_id = ? AND user_id = ?",
        [groupId, memberId]
      );

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

      // --- SCAN RECEIPT WITH GEMINI API ---
  app.post("/api/scan-receipt", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { imageBase64, mimeType } = req.body;

    if (!imageBase64) {
      res.status(400).json({ error: "Receipt image in base64 format is required." });
      return;
    }

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        res.status(400).json({ error: "GEMINI_API_KEY environment variable is required to scan receipts." });
        return;
      }

      // Lazy initialization of Gemini client to prevent crash on startup if API key is missing
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          }
        }
      });

      // Strip data uri preamble if present
      const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");

      const promptString = `Extract the following details from this receipt:
1. Merchant/Store Name
2. Total Amount Paid (numeric value only, e.g., 29.99)
3. Date of purchase (formatted as YYYY-MM-DD, e.g., 2026-06-05)
4. A standard single-word category that best fits this receipt, strictly chosen from: "utilities", "food", "transport", "travel", "entertainment", "recreation", "groceries", "home", "rent", "insurance", "other".
`;

      const scanParams = {
        contents: [
          {
            inlineData: {
              data: cleanBase64,
              mimeType: mimeType || "image/jpeg"
            }
          },
          {
            text: promptString
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              merchant: { type: Type.STRING, description: "The name of the merchant/store" },
              amount: { type: Type.NUMBER, description: "The total amount paid on the receipt, as a float number" },
              date: { type: Type.STRING, description: "The date of the purchase in YYYY-MM-DD format" },
              category: { type: Type.STRING, description: "One of standard categories: utilities, food, transport, travel, entertainment, recreation, groceries, home, rent, insurance, other" }
            },
            required: ["merchant", "amount", "date"]
          }
        }
      };

      // Helper for model retries and fallbacks
      const modelsToTry = ["gemini-3.5-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"];
      let response: any = null;
      let lastErr: any = null;

      for (const model of modelsToTry) {
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            console.log(`Scanning receipt with ${model} (attempt ${attempt}/2)...`);
            response = await ai.models.generateContent({
              model,
              ...scanParams
            });
            break; // Break the attempt loop if successful
          } catch (err: any) {
            lastErr = err;
            const errStr = String(err.message || err);
            const isTransient = errStr.includes("503") || 
                                errStr.includes("demand") || 
                                errStr.includes("UNAVAILABLE") || 
                                errStr.includes("ResourceExhausted") ||
                                errStr.includes("429");
            if (isTransient) {
              console.warn(`Attempt ${attempt} with ${model} failed due to demand/limits: ${errStr}. Retrying after delay...`);
              await new Promise((resolve) => setTimeout(resolve, 1000));
              continue;
            } else {
              break; // Don't retry different attempts if it's a client or structural error
            }
          }
        }
        if (response) break; // Break model loop if successful
      }

      if (!response && lastErr) {
        throw lastErr;
      }

      const text = response?.text;
      if (!text) {
        throw new Error("Empty response from Gemini.");
      }

      const parsed = JSON.parse(text);
      res.json({ result: parsed });
    } catch (err: any) {
      console.error("Gemini Scan Receipt Error:", err);
      res.status(500).json({ error: "Failed to scan receipt: " + err.message });
    }
  });

  // --- EXPENSE ROUTES ---

  // 11. Add Expense
  app.post("/api/groups/:groupId/expenses", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { groupId } = req.params;
    const { description, amount, paidById, splitType, splits, createdAt } = req.body;
    // splits expected: Array of { userId: string, ratio: number (actual amount/percentage/share) }

    if (!description || !description.trim()) {
      res.status(400).json({ error: "Description is required." });
      return;
    }
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      res.status(400).json({ error: "Amount must be a positive number." });
      return;
    }
    if (!paidById) {
      res.status(400).json({ error: "Payer is required." });
      return;
    }
    if (!splits || !Array.isArray(splits) || splits.length === 0) {
      res.status(400).json({ error: "At least one split partition is required." });
      return;
    }

    try {
      const db = await getDb();
      const expenseId = "e-" + Math.random().toString(36).substr(2, 9);
      const now = new Date().toISOString();

      // We need to calculate split amounts precisely based on type
      let calculatedSplits: { userId: string; amount: number; ratio: number }[] = [];

      if (splitType === "equal") {
        const splitCount = splits.length;
        const baseSplitAmt = Math.floor((parsedAmount / splitCount) * 100) / 100;
        let runningSum = 0;

        for (let i = 0; i < splitCount; i++) {
          const s = splits[i];
          // Distribute any remainder to the first split item
          const amt = i === 0 ? parseFloat((parsedAmount - baseSplitAmt * (splitCount - 1)).toFixed(2)) : baseSplitAmt;
          calculatedSplits.push({
            userId: s.userId,
            amount: amt,
            ratio: 1.0,
          });
        }
      } else if (splitType === "unequal") {
        let totalInputAmt = 0;
        for (const s of splits) {
          const amt = parseFloat(s.ratio.toString());
          if (isNaN(amt) || amt < 0) {
            res.status(400).json({ error: "Unequal split amounts must be positive values." });
            return;
          }
          totalInputAmt += amt;
          calculatedSplits.push({
            userId: s.userId,
            amount: parseFloat(amt.toFixed(2)),
            ratio: amt,
          });
        }
        // Validate total
        if (Math.abs(totalInputAmt - parsedAmount) > 0.05) {
          res.status(400).json({ error: `The sum of split amounts ($${totalInputAmt.toFixed(2)}) must equal the total expense amount ($${parsedAmount.toFixed(2)}).` });
          return;
        }
      } else if (splitType === "percentage") {
        let totalPct = 0;
        for (const s of splits) {
          const pct = parseFloat(s.ratio.toString());
          if (isNaN(pct) || pct < 0) {
            res.status(400).json({ error: "Split percentages must be positive values." });
            return;
          }
          totalPct += pct;
        }

        // Must equal 100%
        if (Math.abs(totalPct - 100) > 0.1) {
          res.status(400).json({ error: "Splits percentage must total exactly 100%." });
          return;
        }

        let allocatedSoFar = 0;
        for (let i = 0; i < splits.length; i++) {
          const s = splits[i];
          const pct = parseFloat(s.ratio.toString());
          let amt = parseFloat((parsedAmount * (pct / 100)).toFixed(2));
          
          if (i === splits.length - 1) {
            // Allocate remainder precisely due to rounding
            amt = parseFloat((parsedAmount - allocatedSoFar).toFixed(2));
          } else {
            allocatedSoFar += amt;
          }

          calculatedSplits.push({
            userId: s.userId,
            amount: amt,
            ratio: pct,
          });
        }
      } else if (splitType === "shares") {
        let totalShares = 0;
        for (const s of splits) {
          const sh = parseFloat(s.ratio.toString());
          if (isNaN(sh) || sh < 0) {
            res.status(400).json({ error: "Shares values must be positive." });
            return;
          }
          totalShares += sh;
        }

        if (totalShares <= 0) {
          res.status(400).json({ error: "Total shares must be higher than zero." });
          return;
        }

        let allocatedSoFar = 0;
        for (let i = 0; i < splits.length; i++) {
          const s = splits[i];
          const sh = parseFloat(s.ratio.toString());
          let amt = parseFloat((parsedAmount * (sh / totalShares)).toFixed(2));

          if (i === splits.length - 1) {
            amt = parseFloat((parsedAmount - allocatedSoFar).toFixed(2));
          } else {
            allocatedSoFar += amt;
          }

          calculatedSplits.push({
            userId: s.userId,
            amount: amt,
            ratio: sh,
          });
        }
      }

      // Execute insertions inside database Transaction
      await db.run("BEGIN TRANSACTION");

      const expDateString = createdAt ? new Date(createdAt).toISOString() : now;

      await db.run(
        "INSERT INTO expenses (id, group_id, description, amount, created_by, split_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [expenseId, groupId, description.trim(), parsedAmount, paidById, splitType, expDateString]
      );

      for (const cs of calculatedSplits) {
        const splitId = "s-" + Math.random().toString(36).substr(2, 9);
        await db.run(
          "INSERT INTO expense_splits (id, expense_id, user_id, amount, ratio) VALUES (?, ?, ?, ?, ?)",
          [splitId, expenseId, cs.userId, cs.amount, cs.ratio]
        );
      }

      await db.run("COMMIT");

      res.json({ success: true, expenseId });
    } catch (err: any) {
      try {
        const db = await getDb();
        await db.run("ROLLBACK");
      } catch (rErr) {}
      res.status(500).json({ error: "Failed to record expense: " + err.message });
    }
  });

  // 12. List Group Expenses (with Payer Name + Split info)
  app.get("/api/groups/:groupId/expenses", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { groupId } = req.params;
    try {
      const db = await getDb();
      const expenses = await db.all(`
        SELECT e.*, u.name as payer_name
        FROM expenses e
        JOIN users u ON e.created_by = u.id
        WHERE e.group_id = ?
        ORDER BY e.created_at DESC
      `, [groupId]);

      // Bundle splitting details along with each expense
      const enrichedExpenses = [];
      for (const e of expenses) {
        const splits = await db.all(`
          SELECT es.*, u.name as user_name
          FROM expense_splits es
          JOIN users u ON es.user_id = u.id
          WHERE es.expense_id = ?
        `, [e.id]);

        enrichedExpenses.push({
          ...e,
          splits,
        });
      }

      res.json({ expenses: enrichedExpenses });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 13. Delete Expense
  app.delete("/api/expenses/:expenseId", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { expenseId } = req.params;
    try {
      const db = await getDb();
      await db.run("DELETE FROM expenses WHERE id = ?", [expenseId]);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- SETTLEMENT / PAYMENTS ROUTES ---

  // 14. Record Payment / Settle Debt
  app.post("/api/groups/:groupId/settlements", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { groupId } = req.params;
    const { payerId, payeeId, amount } = req.body;

    const parsedAmount = parseFloat(amount);
    if (!payerId || !payeeId || isNaN(parsedAmount) || parsedAmount <= 0) {
      res.status(400).json({ error: "Payer, recipient, and positive amount are required." });
      return;
    }

    try {
      const db = await getDb();
      const settlementId = "st-" + Math.random().toString(36).substr(2, 9);
      const now = new Date().toISOString();

      await db.run(
        "INSERT INTO settlements (id, group_id, payer_id, payee_id, amount, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [settlementId, groupId, payerId, payeeId, parsedAmount, now]
      );

      res.json({ success: true, settlementId });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to record payment: " + err.message });
    }
  });

  // 15. List recorded settlements for a group
  app.get("/api/groups/:groupId/settlements", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { groupId } = req.params;
    try {
      const db = await getDb();
      const settlements = await db.all(`
        SELECT s.*, u1.name as payer_name, u2.name as payee_name
        FROM settlements s
        JOIN users u1 ON s.payer_id = u1.id
        JOIN users u2 ON s.payee_id = u2.id
        WHERE s.group_id = ?
        ORDER BY s.created_at DESC
      `, [groupId]);

      res.json({ settlements });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 16. BALANCES ENGINE (Groupwise balance sheet AND debt simplification)
  app.get("/api/groups/:groupId/balances", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { groupId } = req.params;
    try {
      const db = await getDb();

      // Retrieve all members of this group
      const members = await db.all(`
        SELECT u.id, u.name, u.email
        FROM group_members gm
        JOIN users u ON gm.user_id = u.id
        WHERE gm.group_id = ?
      `, [groupId]);

      const memberIds = members.map((m) => m.id);
      const balances: Record<string, { id: string; name: string; email: string; netBalance: number; paid: number; owed: number }> = {};
      
      // Initialize balances structure
      for (const m of members) {
        balances[m.id] = {
          id: m.id,
          name: m.name,
          email: m.email,
          netBalance: 0,
          paid: 0,
          owed: 0,
        };
      }

      // Fetch all group expenses
      const expenses = await db.all("SELECT id, created_by, amount FROM expenses WHERE group_id = ?", [groupId]);
      for (const e of expenses) {
        // Payer increases credit
        if (balances[e.created_by]) {
          balances[e.created_by].paid += e.amount;
        }

        // Find splits for this expense
        const splits = await db.all("SELECT user_id, amount FROM expense_splits WHERE expense_id = ?", [e.id]);
        for (const s of splits) {
          if (balances[s.user_id]) {
            balances[s.user_id].owed += s.amount;
          }
        }
      }

      // Fetch all settlements
      const settlements = await db.all("SELECT payer_id, payee_id, amount FROM settlements WHERE group_id = ?", [groupId]);
      
      // Net Balance formulas: netBalance = Paid - Owed + SettlementsMadeAsPayer - SettlementsReceivedAsPayee
      for (const id of memberIds) {
        let net = balances[id].paid - balances[id].owed;
        
        // Add settlements where this member paid off money
        const made = settlements
          .filter((s) => s.payer_id === id)
          .reduce((sum, s) => sum + s.amount, 0);
          
        // Subtract settlements where this member received payments
        const received = settlements
          .filter((s) => s.payee_id === id)
          .reduce((sum, s) => sum + s.amount, 0);

        balances[id].netBalance = parseFloat((net + made - received).toFixed(2));
      }

      // DEBT SIMPLIFICATION ALGORITHM
      const debtors: { id: string; name: string; bal: number }[] = [];
      const creditors: { id: string; name: string; bal: number }[] = [];

      for (const id of memberIds) {
        const bal = balances[id].netBalance;
        if (bal < -0.01) {
          debtors.push({ id, name: balances[id].name, bal });
        } else if (bal > 0.01) {
          creditors.push({ id, name: balances[id].name, bal });
        }
      }

      // Sort: highest debtor first (most negative is smallest value)
      debtors.sort((a, b) => a.bal - b.bal);
      // Sort: highest creditor first
      creditors.sort((a, b) => b.bal - a.bal);

      const simplifiedDebts: { from: string; fromName: string; to: string; toName: string; amount: number }[] = [];

      let dIdx = 0;
      let cIdx = 0;

      // Deep copy balances so we can mutate safely in calculation
      const dWorking = debtors.map((d) => ({ ...d }));
      const cWorking = creditors.map((c) => ({ ...c }));

      while (dIdx < dWorking.length && cIdx < cWorking.length) {
        const debtorObj = dWorking[dIdx];
        const creditorObj = cWorking[cIdx];

        const debtAmount = Math.min(Math.abs(debtorObj.bal), creditorObj.bal);
        if (debtAmount > 0.01) {
          simplifiedDebts.push({
            from: debtorObj.id,
            fromName: debtorObj.name,
            to: creditorObj.id,
            toName: creditorObj.name,
            amount: parseFloat(debtAmount.toFixed(2)),
          });
        }

        // Adjust working balances
        debtorObj.bal += debtAmount;
        creditorObj.bal -= debtAmount;

        if (Math.abs(debtorObj.bal) < 0.01) {
          dIdx++;
        }
        if (creditorObj.bal < 0.01) {
          cIdx++;
        }
      }

      res.json({
        balances: Object.values(balances),
        simplifiedDebts,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- EXPENSE CHATS / COMMENT SYSTEM ---

  // 17. Post Chat Comment on Expense
  app.post("/api/expenses/:expenseId/chats", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { expenseId } = req.params;
    const { message } = req.body;
    const userId = req.user!.id;

    if (!message || !message.trim()) {
      res.status(400).json({ error: "Message cannot be empty." });
      return;
    }

    try {
      const db = await getDb();
      const chatId = "c-" + Math.random().toString(36).substr(2, 9);
      const now = new Date().toISOString();

      await db.run(
        "INSERT INTO chats (id, expense_id, user_id, message, created_at) VALUES (?, ?, ?, ?, ?)",
        [chatId, expenseId, userId, message.trim(), now]
      );

      res.json({ success: true, chatId });
    } catch (err: any) {
      res.status(500).json({ error: "Chat post failed: " + err.message });
    }
  });

  // 18. Fetch Chat Messages for Expense (polling endpoints support real-time feel!)
  app.get("/api/expenses/:expenseId/chats", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { expenseId } = req.params;
    try {
      const db = await getDb();
      const messages = await db.all(`
        SELECT c.*, u.name as user_name, u.email as user_email
        FROM chats c
        JOIN users u ON c.user_id = u.id
        WHERE c.expense_id = ?
        ORDER BY c.created_at ASC
      `, [expenseId]);

      res.json({ messages });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- VITE DEV MIDDLEWARE AND STATIC SERVING ---
  if (process.env.NODE_ENV !== "production") {
    // Dynamically import Vite server in dev mode
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve production static builds from /dist
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Splitwise Backend Server is actively running on host 0.0.0.0 port ${PORT}`);
  });
}

run().catch((e) => {
  console.error("FATAL CRASH on Splitwise Server Start: ", e);
});
