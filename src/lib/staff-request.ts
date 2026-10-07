"use client";
import { friendlyError } from "./staff-presentation";

export async function staffRequest<T = Record<string, unknown>>(
  action: string,
  data: Record<string, unknown>,
): Promise<T> {
  const response = await fetch("/api/staff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, data }),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      friendlyError(body.error ?? "Unable to save. Please try again."),
    );
  return body as T;
}
