import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SignedInContext } from '@/lib/session-context';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), oauth: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  useNavigate: () => mocks.navigate,
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { signInWithOAuth: mocks.oauth } } }));
import { Route } from '@/routes/auth';

describe('Okta callback session return', () => {
  it('continues to dashboard when the root session arrives after the auth page renders', async () => {
    const Page = (Route as unknown as { component: React.ComponentType }).component;
    const { rerender, unmount } = render(<SignedInContext.Provider value={false}><Page /></SignedInContext.Provider>);
    expect(mocks.navigate).not.toHaveBeenCalled();
    rerender(<SignedInContext.Provider value={true}><Page /></SignedInContext.Provider>);
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: '/dashboard', replace: true }));
    unmount();
  });
});