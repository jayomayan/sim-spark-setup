import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SignedInContext } from '@/lib/session-context';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), oauth: vi.fn(), signin: vi.fn(), signup: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  useNavigate: () => mocks.navigate,
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { signInWithOAuth: mocks.oauth, signInWithPassword: mocks.signin, signUp: mocks.signup } } }));
import { Route } from '@/routes/auth';

describe('Okta callback session return', () => {
  it('submits local credentials only for sign-in, never registration', async () => {
    mocks.signin.mockResolvedValue({ error: null });
    const Page = (Route as unknown as { component: React.ComponentType }).component;
    const { getByLabelText, getByRole, unmount } = render(<SignedInContext.Provider value={false}><Page /></SignedInContext.Provider>);
    fireEvent.change(getByLabelText('Username or email'), { target: { value: 'partner@example.invalid' } });
    fireEvent.change(getByLabelText('Password'), { target: { value: 'Test-only-password1!' } });
    fireEvent.click(getByRole('button', { name: 'Sign in', exact: true }));
    await waitFor(() => expect(mocks.signin).toHaveBeenCalledWith({ email: 'partner@example.invalid', password: 'Test-only-password1!' }));
    expect(mocks.signup).not.toHaveBeenCalled();
    mocks.navigate.mockClear();
    unmount();
  });
  it('continues to dashboard when the root session arrives after the auth page renders', async () => {
    const Page = (Route as unknown as { component: React.ComponentType }).component;
    const { rerender, unmount } = render(<SignedInContext.Provider value={false}><Page /></SignedInContext.Provider>);
    expect(mocks.navigate).not.toHaveBeenCalled();
    rerender(<SignedInContext.Provider value={true}><Page /></SignedInContext.Provider>);
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: '/dashboard', replace: true }));
    unmount();
  });
});