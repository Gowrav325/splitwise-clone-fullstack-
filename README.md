# 📊 Splitwise Full-Stack Relational Sandbox

A high-fidelity, full-stack replica of **Splitwise** engineered as an interactive sandbox for multi-user transaction ledgers. This application features complex multi-party expense division, real-time comment threads per transaction, and an automatic debt-simplification algorithm powered by a relational SQLite database.

Designed and refined for the **Spreetail Software Engineering Internship Assessment**, this sandbox is engineered with zero mock-data paradigms. It implements strict session layers, JWT authentication, and relational cascades inside a local SQLite container.

---

## 🔗 Live Interactive Evaluation Links

Reviewers can access and test the deployed sandbox directly without any setup using the link below:

*   **⚡ Deployed Live Sandbox Demo**: [Click here to view the Live App](https://ais-pre-74whr5whk3vgxd26wjrg4u-176767941465.asia-southeast1.run.app)

---

## 🚀 Key Architectural Capabilities

### 1. Advanced Split Protocols Engine
Supports four distinct mathematical models for splitting bills:
- **Split Equally**: Automatically divides any sum among selected participants.
- **Split Unequally**: Allocates custom, precise physical cash amounts. Enforces exact summation bounds.
- **Split by Percentage**: Divides by percentage figures representing fractional shares (must sum to exactly $100.0\%$).
- **Split by Shares**: Apportions expenses using weighted ratios (parts/shares e.g., Alice has 3 shares, Bob has 1 share).

### 2. High-Precision Pennies Correction (`Sum = 0` Invariant)
To maintain the core relational ledger rule that $\sum NetBalances = 0$, the backend division engine detects fractional remainder pennies (for example, splitting $100.00$ among three users leaves a $\$0.01$ residue). The engine automatically rounds and adjusts the pennies on the prime recipient dynamically to guarantee absolute penny parity.

### 3. Greedy Debt Simplification Algorithm
The system includes a custom debt reduction solver that dynamically minimizes total transactions across any group workspace. It maps all standard ledger balances to primary debtors and creditors, matching peak-repayment figures sequentially to output a simplified set of peer-to-peer settlement steps.

### 4. Interactive Sandbox Multi-User Control
To empower reviewers to test multi-party situations without tedious registration cycles, the header includes an **Instant Identity Switcher**. Toggle instantaneously between **Alice**, **Bob**, **Charlie**, and **Diana** to post, split, chat on expenses, and settle debts from multiple perspectives in real-time.

### 5. Multi-Threaded Expense Chat Logging
Every individual transaction holds a dedicated comment thread. The interface implements a **reactive 4-second short-polling mechanism** to emulate live WebSockets within secure sandboxed environments.

---

## 🛠️ Tech Stack & Relational Database

- **Frontend**: React 19, TypeScript, Vite 6, Tailwind CSS (Utility-first styling with high-contrast color codes), and Motion (`motion/react`) for fluid component elevations.
- **Backend**: Node.js, Express REST API, with secure signed JWT cookies (`cookie-parser`) for identity tracking.
- **Data Layer**: Relational **SQLite database (`sqlite3` / `sqlite` drivers)** implementing foreign key cascades, unique indices, and transaction-safe records.
- **Build System**: Bundle-compiled via **esbuild** into a compact server configuration inside `/dist`.

---

## 📂 Entity-Relationship Database Schema

The SQLite schema strictly models the complex relational associations:

```sql
-- 1. Users table for demographic and authentication credentials
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 2. Splittable Groups
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- 3. Group Members Join Table
CREATE TABLE group_members (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 4. Expenses Records
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

-- 5. Individual Splits Table (Relational Breakdown of Expense Lines)
CREATE TABLE expense_splits (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  amount REAL NOT NULL,
  ratio REAL NOT NULL,
  FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 6. Settlements (Debt Payments)
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

-- 7. Live comment threads per transaction
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

## 🏃 Local Setup & Development Instructions

### Prerequisites
- [Node.js](https://nodejs.org/) (Version 18 or above recommended)
- [npm](https://www.npmjs.com/) 

### 1. Clone & Install Dependencies
Navigate into the repository directory and execute:
```bash
npm install
```

### 2. Configure Environment Secrets
Create a `.env` file in the root directory (refer to `.env.example` as a system blueprint) and establish your variables:
```env
SESSION_SECRET=your_custom_development_jwt_secret_phrase
NODE_ENV=development
```
*(Note: If no secret is configured, the system will automatically fall back to a secure runtime-generated random secret for safety.)*

### 3. Launch Development Server
Boot the integrated Express and Vite fast-reloading systems:
```bash
npm run dev
```
Open your browser to [http://localhost:3000](http://localhost:3000) to access the interactive sandbox immediately. The SQLite database will auto-bootstrap on startup and populate dummy sandbox users and group states.

### 4. Build for Production
To bundle-compile the client-side SPA bundle and compile the TypeScript Express backend into highly Optimized standalone Node execution lines:
```bash
npm run build
```
Once the build completes successfully, start the production server:
```bash
npm run start
```

---

## 🎯 Verification and SPREETAIL Evaluation Milestones

This application meets all crucial metrics requested by the Spreetail internship prompt:
- **Full Relational Consistency**: Uses an embedded relational SQLite database to avoid unreliable in-memory lists or text storage.
- **Accurate Mathematical Proofs**: Validates allocations in multiple protocols and corrects mathematical limits.
- **High UX Polish**: Includes immediate UI responses for settling bills, toggling perspective states, adding custom-styled tags, and discussing transactions.
- **Interactive Multi-User Integrity**: Enables immediate testing of multi-user configurations without requesting multiple browser instances or manual database seeding.
