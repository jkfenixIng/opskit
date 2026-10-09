// @vitest-environment jsdom

import { createElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmationDialog } from '../components/confirmation-dialog';
import { es } from '../i18n/es';

afterEach(() => { document.body.innerHTML = ''; document.body.style.overflow = ''; });

describe('ConfirmationDialog', () => {
  it('keeps keyboard focus in the dialog, closes with Escape, and restores the activator', () => {
    const cancel = vi.fn();
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    render(createElement('div', null, createElement('div', { id: 'app-shell-content' }, createElement('button', null, 'Background')), createElement(ConfirmationDialog, { title: 'Delete', description: 'Cannot be undone.', confirmLabel: 'Delete', onConfirm: vi.fn(), onCancel: cancel })));
    const dialog = screen.getByRole('dialog');
    const cancelButton = screen.getByRole('button', { name: es.dialog.cancel });
    const confirmButton = screen.getByRole('button', { name: 'Delete' });
    expect(document.activeElement).toBe(cancelButton);
    expect(document.getElementById('app-shell-content')?.hasAttribute('inert')).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    confirmButton.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(cancelButton);
    cancelButton.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirmButton);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('restores background interactivity and focus when unmounted', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const view = render(createElement('div', null, createElement('div', { id: 'app-shell-content' }, createElement('button', null, 'Background')), createElement(ConfirmationDialog, { title: 'Delete', description: 'Cannot be undone.', confirmLabel: 'Delete', onConfirm: vi.fn(), onCancel: vi.fn() })));
    view.unmount();
    expect(document.getElementById('app-shell-content')?.hasAttribute('inert') ?? false).toBe(false);
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(trigger);
  });
});
