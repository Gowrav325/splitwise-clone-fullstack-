# SPREETAIL Evaluation: AI_CONTEXT.md - Source of Truth
**Project Name**: Splitwise Clone (Full-Stack Relational Sandbox Edition)  
**Assigned Role**: Product Manager & Systems Software Developer

---

## 1. Product Understanding & Reverse Engineering Focus
Splitwise operates fundamentally as a **distributed ledger ledger system**. The core product objectives include:
- **Ledger Invariants**: The sum of all outstanding nets across any group must *always* equal precisely zero ($\sum NetBalances = 0$).
- **Minimizing Cognitive Friction**: Multi-party transactions require custom fractional distributions (by weights, parts, unequal cash allocations, or raw percentages) with automated, faultless rounding corrections.
- **Settlement Acceleration**: Suggesting direct and simplified balances cuts down extraneous debt loops (e.g., if A owes B $20 and B owes C $20, simplify so A directly pays C $20).
- **Interactive Cooperation**: Real-time communication directly on a specific expense line removes ambiguities about what was bought.

---

## 2. Product Scope (MVP Bound)
### In-Scope Core Capabilities:
1. **Dynamic Sandbox Authentication**: 
   - Supports both native registration/signin AND an **instant multi-user switcher card** in the header.
   - Switch between **Alice Smith**, **Bob Johnson**, **Charlie Brown**, and **Diana Prince** with a single click in the header dropdown to easily simulate multi-user splits, settlements, and live conversations.
2. **Relational Group Workspace**: Establish, read, list, and delete group members dynamically.
3. **Four-Protocol Shared Expense Division Engine**:
   - *Split Equally*: Automates divisions.
   - *Split Unequally*: Allows granular absolute cash inputs.
   - *Split by Percent*: Enforces strict sum checks ($100.0\%$).
   - *Split by Shares*: Translates relative weights (e.g. 2 shares, 1 share).
   - *Automatic Remainder Distribution*: Any fractions lost from mathematical divisions (e.g., split $100.00 among 3 users = $33.33) are automatically gathered and balanced on the prime receiver so overall pennies align perfectly.
4. **Group Wise Ledger & Debt Advisor**: Calculates precise individual balance books and compiles simplified payback plans.
5. **Real-Time Polling Expense Chats**: Stretches full-featured REST feeds with 4-second reactive polling timers to mimic live WebSockets inside standard sandboxed browser iframes.
6. **Debt Settling Action Console**: Clears specific debts with a single click and logs standard payment receipts.

### Out-of-Scope (Tradeoffs):
1. *Multi-currency supports*: Default value is strictly locked to US Dollar (`$`).
2. *Real image uploads*: Profile avatars and paper receipt scans have been placeholder-abstracted for container memory conservation.

---

## 3. High-Fidelity Tech Stack
- **Frontend Architecture**: React (v19) with JSX, TypeScript type safety, compiled using Vite (v6).
- **Aesthetic Styling Layout**: Tailwind CSS utility classes pairing soft light-slate cards, clean typography, vibrant Emerald indices for credits (`gets back`), and deep Rose indices for debits (`owes`).
- **Backend Architecture**: Node.js, Express REST web services, compiled on esbuild into a self-contained runtime.
- **Relational Datastore Engine**: SQLite3 via standard driver, fully matching SPREETAIL's *"relational DBs only"* instruction. It runs locally as a resilient, auto-bootstrapping engine in the container without requiring credential handshakes.
- **Session Layer**: JSON Web Tokens (`jsonwebtoken`) signed by an automatic secret, mounted over secure HTTP-only cookies (`cookie-parser`).
- **Interactive Animations**: Micro-interactions powered by `motion/react` (staggered entrances, drawer slide downs).

---

## 4. Entity-Relationship Relational Database Schema
Our SQLite schema enforces strong dynamic cascades and foreign key constraints:

```sql
-- 1. Users Table
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 2. Groups Table
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- 3. Group Members (Join Table)
CREATE TABLE group_members (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 4. Expenses Table
CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  created_by TEXT NOT NULL,
  split_type TEXT NOT NULL, -- 'equal', 'unequal', 'percentage', 'shares'
  created_at TEXT NOT NULL,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

-- 5. Expense Splits Table
CREATE TABLE expense_splits (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  amount REAL NOT NULL,
  ratio REAL NOT NULL, -- weight/percentage/unequal dollar helper
  FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 6. Settlements / Debt Payments Table
CREATE TABLE settlements (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  payer_id TEXT NOT NULL,
  payee_id TEXT NOT NULL,
  amount REAL NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (payer_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (payee_id) REFERENCES users(id) ON DELETE RESTRICT
);

-- 7. Live Expense Chats
CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

---

## 5. API Design & Routing Specifications

### Authentication:
* `POST /api/auth/signup`: Validates entries, adds user, issues JWT cookie.
* `POST /api/auth/login`: Custom credentials validation.
* `POST /api/auth/logout`: Clears session cookie.
* `GET /api/auth/me`: Decodes JWT payload to certify user metadata.
* `GET /api/auth/users`: Returns registered user database list to ease invitation picker.

### Groups & Members:
* `GET /api/groups`: Checks active user, returns all groups they belong to.
* `POST /api/groups`: Creates group and atomically registers creator into membership index.
* `GET /api/groups/:groupId`: Returns detailed group data + list of current members.
* `POST /api/groups/:groupId/members`: Integrates a member via selective user ID or custom email registration.
* `DELETE /api/groups/:groupId/members/:memberId`: Evicts user from active workspace.

### Expenses & Settlements:
* `POST /api/groups/:groupId/expenses`: Enforces split protocols and records splits.
* `GET /api/groups/:groupId/expenses`: List expenses with payer and individual split breakdowns.
* `DELETE /api/expenses/:expenseId`: Erases specific transaction.
* `POST /api/groups/:groupId/settlements`: Confirms transaction settles.
* `GET /api/groups/:groupId/settlements`: Lists history payment transactions.

### Core Math Balance Engine:
* `GET /api/groups/:groupId/balances`: 
  1. Computes total ledger for group $G$.
  2. For each member $M$, calculates sum of paid expenses $P$ and owed splits $O$.
  3. Integrates settlements made ($S_{made}$ as payer) and received ($S_{received}$ as payee):
     $$NetBalance_M = P_M - O_M + S_{made, M} - S_{received, M}$$
  4. Organizes outstanding balances into a greedy debt matching solver (Simplification algorithm) to list target actions.

### Chats:
* `GET /api/expenses/:expenseId/chats`: Returns commenting list.
* `POST /api/expenses/:expenseId/chats`: Registers a comment on an expense line which will sync via 4-second short polling in the frontend.

---

## 6. Implementation Decisions, Tradeoffs & Known Limitations
- *Why SQLite instead of Postgres?*: Postgres is exceptional but local setups require tedious environment parameters. SQLite provides a robust relational engine inside an isolated, container-safe filesystem that compiles instantly without external infrastructure configuration.
- *Why Polling Chats over WebSockets?*: WebSockets are brilliant but can break in sandboxed browser iframes due to CORS policies and secure reverse proxies. Fast REST polling is highly performant and offers a robust, near-real-time chat experience out-of-the-box.
- *How is state managed?*: Client state is handled using native React state and hooks (e.g. `useEffect` handles polling triggers and resets cleanly on component unmount to prevent memory leaks).

---

## 7. Prompts and AI Collaboration Process
### Human Guidelines Provided:
*"You are a junior engineer helping me complete an internship assignment. The assignment is to reverse engineer Splitwise, scope a realistic 3-day version, and build a working deployed app. Do not assume product requirements. Ask me detailed questions before building."*

### AI Responses & Progress:
- Analyzed package registry to understand framework bindings.
- Created `db.ts` to boot relational tables and mock demo records for Alice, Bob, Charlie, and Diana on startup.
- Assembled Express core controller inside `server.ts` to implement JWT authentication and calculations.
- Programmed a comprehensive UI in `App.tsx` incorporating custom mathematical splits inputs.
- Preserved SPREETAIL context inside `AI_CONTEXT.md` and `BUILD_PLAN.md`.
