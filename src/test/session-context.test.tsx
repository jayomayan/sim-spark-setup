import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SignedInContext, useSignedIn } from "@/lib/session-context";

describe("Shared signed-in state", () => {
  it("reports a signed-in session", () => {
    const { result } = renderHook(useSignedIn, {
      wrapper: ({ children }) => <SignedInContext.Provider value={true}>{children}</SignedInContext.Provider>,
    });
    expect(result.current).toBe(true);
  });
  it("reports a signed-out session", () => {
    const { result } = renderHook(useSignedIn, {
      wrapper: ({ children }) => <SignedInContext.Provider value={false}>{children}</SignedInContext.Provider>,
    });
    expect(result.current).toBe(false);
  });
});