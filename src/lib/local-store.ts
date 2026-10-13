"use client";

// Tiny typed localStorage helpers for pilot-scoped, device-local state.
// Used for todos, goals, and the opt-in crew list until their server
// counterparts ship. Everything here is honest about where it lives.

export function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeLocal<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked — the in-memory state still works this session.
  }
}

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
}

export interface GoalItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
}

export interface CrewMember {
  id: string;
  name: string;
  birthdate: string;
  schoolDistrict: string;
  sync: string[];
  addedAt: number;
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
