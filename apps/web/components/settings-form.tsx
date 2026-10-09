"use client";

import { useEffect, useRef, useState } from "react";
import type { OrganizationSettingsInput } from "@opskit/contracts";
import { interpolate, labelFor, useMessages } from "../i18n";
import { errorMessage } from "../i18n/errors";
import { formatPercent } from "../i18n/format";
import { paymentMethodLabel } from "../i18n/labels";
import { api } from "./api";
import { AppShell } from "./app-shell";
import { SignIn, useSession } from "./session";

const timeZones = ["UTC", ...Intl.supportedValuesOf("timeZone")];

export function SettingsForm() {
  const t = useMessages();
  const s = t.settings;
  const { user, setUser, loading } = useSession();
  const [settings, setSettings] = useState<OrganizationSettingsInput | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  useEffect(() => {
    if (user)
      api<OrganizationSettingsInput>("settings")
        .then(setSettings)
        .catch((reason) => setMessage(errorMessage(reason, s.loadFailed)));
  }, [user, s]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  if (loading)
    return (
      <main className="standalone-state" aria-live="polite">
        {s.loading}
      </main>
    );
  if (!user) return <SignIn onSignedIn={setUser} />;
  const signOut = async () => {
    await api<void>("auth/logout", { method: "POST" });
    setUser(null);
  };
  const update = (next: Partial<OrganizationSettingsInput>) => {
    if (!settings) return;
    setSettings({ ...settings, ...next });
    setDirty(true);
  };
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!settings || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      setSettings(
        await api<OrganizationSettingsInput>("settings", {
          method: "PUT",
          body: JSON.stringify(settings),
        }),
      );
      setDirty(false);
      setMessage(s.saved);
    } catch (reason) {
      setMessage(errorMessage(reason, s.saveFailed));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  return (
    <AppShell user={user} onSignOut={signOut} hasUnsavedChanges={dirty}>
      <section className="page-header">
        <div>
          <p className="eyebrow">{s.eyebrow}</p>
          <h1>{s.title}</h1>
          <p>{s.description}</p>
        </div>
      </section>
      {!settings ? (
        <section className="state-panel" role={message ? "alert" : undefined}>
          {message ?? s.loading}
        </section>
      ) : (
        <form onSubmit={save} className="settings-form">
          <p className="status" role="status" aria-live="polite">
            {message ?? (dirty ? s.unsaved : s.allSaved)}
          </p>
          <fieldset>
            <legend>{s.identity.legend}</legend>
            <p className="form-hint">{s.identity.hint}</p>
            <label htmlFor="organization-name">{s.identity.name}</label>
            <input
              id="organization-name"
              name="organizationName"
              autoComplete="organization"
              value={settings.name}
              onChange={(event) => update({ name: event.target.value })}
              required
            />
            <label htmlFor="currency-code">{s.identity.currency}</label>
            <input
              id="currency-code"
              name="currency"
              autoComplete="off"
              spellCheck={false}
              inputMode="text"
              maxLength={3}
              value={settings.currency.code}
              onChange={(event) =>
                update({
                  currency: {
                    ...settings.currency,
                    code: event.target.value.toUpperCase(),
                  },
                })
              }
              aria-describedby="currency-help"
              required
            />
            <small id="currency-help">{s.identity.currencyHelp}</small>
            <label htmlFor="timezone">{s.identity.timeZone}</label>
            <select
              id="timezone"
              name="timeZone"
              value={settings.timeZone}
              onChange={(event) => update({ timeZone: event.target.value })}
            >
              {[...new Set([settings.timeZone, ...timeZones])].map((zone) => (
                <option key={zone}>{zone}</option>
              ))}
            </select>
          </fieldset>
          <fieldset>
            <legend>{s.paymentMethods.legend}</legend>
            <p className="form-hint">{s.paymentMethods.hint}</p>
            {settings.paymentMethods.map((method, index) => (
              <label className="check" key={method.code}>
                <input
                  type="checkbox"
                  checked={method.enabled}
                  onChange={(event) =>
                    update({
                      paymentMethods: settings.paymentMethods.map(
                        (item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, enabled: event.target.checked }
                            : item,
                      ),
                    })
                  }
                />{" "}
                <span>
                  {paymentMethodLabel(t, method)}
                  <small>
                    {interpolate(s.paymentMethods.fee, {
                      percent: formatPercent(method.feeBasisPoints / 10_000),
                    })}
                    {method.requiresReference
                      ? s.paymentMethods.referenceRequired
                      : ""}
                  </small>
                </span>
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>{s.modules.legend}</legend>
            <p className="form-hint">{s.modules.hint}</p>
            {settings.modules.map((module, index) => (
              <label className="check" key={module.key}>
                <input
                  type="checkbox"
                  checked={module.enabled}
                  disabled={module.key === "settings"}
                  onChange={(event) =>
                    update({
                      modules: settings.modules.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, enabled: event.target.checked }
                          : item,
                      ),
                    })
                  }
                />{" "}
                <span>
                  {labelFor(t.codes.module, module.key, module.label)}
                  {module.key === "settings" && (
                    <small>{s.modules.required}</small>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>{s.rules.legend}</legend>
            <label className="check">
              <input
                type="checkbox"
                checked={settings.operations.inventory.allowNegativeStock}
                onChange={(event) =>
                  update({
                    operations: {
                      ...settings.operations,
                      inventory: {
                        ...settings.operations.inventory,
                        allowNegativeStock: event.target.checked,
                      },
                    },
                  })
                }
              />{" "}
              <span>
                {s.rules.negativeStock}
                <small>{s.rules.negativeStockHint}</small>
              </span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={settings.operations.invoicing.allowPartialPayments}
                onChange={(event) =>
                  update({
                    operations: {
                      ...settings.operations,
                      invoicing: {
                        ...settings.operations.invoicing,
                        allowPartialPayments: event.target.checked,
                      },
                    },
                  })
                }
              />{" "}
              <span>
                {s.rules.partialPayments}
                <small>{s.rules.partialPaymentsHint}</small>
              </span>
            </label>
          </fieldset>
          <div className="form-actions">
            <button type="submit" disabled={saving}>
              {saving ? s.saving : s.save}
            </button>
          </div>
        </form>
      )}
    </AppShell>
  );
}
