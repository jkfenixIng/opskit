// @vitest-environment jsdom

import { createElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({ usePathname: () => '/settings', useRouter: () => ({ push }) }));
vi.mock('next/link', () => ({ default: ({ href, children, onClick, ...props }: { href: string; children: React.ReactNode; onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void }) => createElement('a', { href, onClick, ...props }, children) }));
import { AppShell } from '../components/app-shell';
import { es } from '../i18n/es';

const user = { id: 'user-1', email: 'user@example.com', role: 'admin' };

afterEach(() => {
  document.body.innerHTML = '';
  push.mockClear();
});

describe('AppShell dirty guard', () => {
  it('confirms before internal navigation and sign out when settings are dirty', () => {
    const signOut = vi.fn();
    render(createElement(AppShell, { user, onSignOut: signOut, hasUnsavedChanges: true }, createElement('p', null, 'Settings')));
    fireEvent.click(screen.getAllByRole('link', { name: es.shell.nav.operations })[0]!);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: es.dialog.cancel }));
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: es.shell.signOut }));
    fireEvent.click(screen.getByRole('button', { name: es.shell.discardConfirm }));
    expect(signOut).toHaveBeenCalledOnce();
  });

  it('confirms before brand navigation when settings are dirty', () => {
    render(createElement(AppShell, { user, onSignOut: vi.fn(), hasUnsavedChanges: true }));
    fireEvent.click(document.querySelector<HTMLAnchorElement>('.brand')!);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: es.shell.discardConfirm }));
    expect(push).toHaveBeenCalledWith('/');
  });

  it('navigates through the brand normally without unsaved changes', () => {
    render(createElement(AppShell, { user, onSignOut: vi.fn() }));
    fireEvent.click(document.querySelector<HTMLAnchorElement>('.brand')!);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(push).toHaveBeenCalledWith('/');
  });
});
