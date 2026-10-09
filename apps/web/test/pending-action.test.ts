// @vitest-environment jsdom

import { createElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePendingAction } from '../components/use-pending-action';

function Fixture({ request }: { request: () => Promise<void> }) {
  const { pending, run } = usePendingAction();
  return createElement('form', { onSubmit: (event: React.FormEvent) => { event.preventDefault(); void run('save', request); } }, createElement('button', { disabled: pending === 'save' }, pending === 'save' ? 'Saving…' : 'Save'));
}

describe('usePendingAction', () => {
  it('sends one request for repeated submits while pending', () => {
    let resolve!: () => void;
    const request = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    render(createElement(Fixture, { request }));
    const button = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(button);
    fireEvent.submit(button.closest('form')!);
    expect(request).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Saving…' })).toHaveProperty('disabled', true);
    resolve();
  });
});
