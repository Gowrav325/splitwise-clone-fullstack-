/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface User {
  id: string;
  name: string;
  email: string;
}

export interface Group {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  creator_name?: string;
  members_count?: number;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  joined_at: string;
}

export interface ExpenseSplit {
  id: string;
  expense_id: string;
  user_id: string;
  user_name?: string;
  amount: number;
  ratio: number;
}

export interface Expense {
  id: string;
  group_id: string;
  description: string;
  amount: number;
  created_by: string;
  payer_name?: string;
  split_type: "equal" | "unequal" | "percentage" | "shares";
  created_at: string;
  splits?: ExpenseSplit[];
}

export interface Settlement {
  id: string;
  group_id: string;
  payer_id: string;
  payer_name?: string;
  payee_id: string;
  payee_name?: string;
  amount: number;
  created_at: string;
}

export interface MemberBalance {
  id: string;
  name: string;
  email: string;
  netBalance: number; // Positive means they are owed money, negative means they owe money
  paid: number;
  owed: number;
}

export interface SimplifiedDebt {
  from: string;
  fromName: string;
  to: string;
  toName: string;
  amount: number;
}

export interface ChatMessage {
  id: string;
  expense_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  message: string;
  created_at: string;
}
