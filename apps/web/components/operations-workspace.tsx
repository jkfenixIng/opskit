"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TillResponse, TillSessionResponse } from "@opskit/contracts";
import { interpolate, labelFor, useMessages, type Messages } from "../i18n";
import { errorMessage } from "../i18n/errors";
import { formatDateTime } from "../i18n/format";
import { alertText, alertTitle } from "../i18n/labels";
import { api, formatMoney } from "./api";
import { AppShell } from "./app-shell";
import { ConfirmationDialog } from "./confirmation-dialog";
import { parseMinorAmount } from "./money-input";
import { SignIn, useSession } from "./session";
import { nextTabIndex } from "./ui-helpers";
import { usePendingAction } from "./use-pending-action";

type Currency = { code: string; minorUnits: number };
type Person = {
  id: string;
  name: string;
  status: string;
  contactIdentifier: string | null;
  roles: string[];
};
type Offering = {
  id: string;
  name: string;
  status: string;
  priceMinor: number | null;
  durationMinutes: number | null;
};
type Alert = {
  id: string;
  kind: string;
  severity: string;
  message: string;
  entityType: string;
  entityId: string;
};
type AuditEvent = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  occurredAt: string;
};
const tabs = ["cash", "people", "offerings", "alerts", "audit"] as const;
type Tab = (typeof tabs)[number];
const post = (path: string, body: unknown) =>
  api(path, { method: "POST", body: JSON.stringify(body) });

function entityReference(t: Messages, type: string, id: string) {
  return interpolate(t.common.entityReference, {
    type: labelFor(t.codes.entityType, type),
    id,
  });
}

function useList<T>(path: string) {
  const t = useMessages();
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    setError(null);
    api<T[]>(path)
      .then(setItems)
      .catch((reason) => {
        setItems(null);
        setError(errorMessage(reason, t.common.loadFailed));
      });
  }, [path, t]);
  useEffect(refresh, [refresh]);
  return { items, error, refresh };
}
function ListState({
  items,
  error,
  empty,
  children,
}: {
  items: unknown[] | null;
  error: string | null;
  empty: string;
  children: React.ReactNode;
}) {
  const t = useMessages();
  if (error)
    return (
      <p className="table-state error" role="alert">
        {error}
      </p>
    );
  if (items === null)
    return (
      <p className="table-state" aria-live="polite">
        {t.common.loading}
      </p>
    );
  if (!items.length) return <p className="table-state empty-state">{empty}</p>;
  return <>{children}</>;
}

export function OperationsWorkspace() {
  const t = useMessages();
  const o = t.operations;
  const { user, setUser, loading } = useSession();
  const [tab, setTab] = useState<Tab>("cash");
  const [currency, setCurrency] = useState<Currency>({
    code: "USD",
    minorUnits: 2,
  });
  const [message, setMessage] = useState<string | null>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    if (user)
      api<{ currency: Currency }>("dashboard")
        .then((data) => setCurrency(data.currency))
        .catch(() => undefined);
  }, [user]);
  if (loading)
    return (
      <main className="standalone-state" aria-live="polite">
        {o.loading}
      </main>
    );
  if (!user) return <SignIn onSignedIn={setUser} />;
  const run = async (work: () => Promise<unknown>, success: string) => {
    try {
      await work();
      setMessage(success);
    } catch (reason) {
      setMessage(errorMessage(reason, t.common.requestFailed));
    }
  };
  const signOut = async () => {
    await api<void>("auth/logout", { method: "POST" });
    setUser(null);
  };
  return (
    <AppShell user={user} onSignOut={signOut}>
      <section className="page-header">
        <div>
          <p className="eyebrow">{o.eyebrow}</p>
          <h1>{o.title}</h1>
          <p>{o.description}</p>
        </div>
      </section>
      <div className="tabs" role="tablist" aria-label={o.tabsLabel}>
        {tabs.map((item, index) => (
          <button
            key={item}
            ref={(node) => {
              refs.current[index] = node;
            }}
            role="tab"
            id={`operations-tab-${index}`}
            aria-selected={item === tab}
            aria-controls={`operations-panel-${index}`}
            tabIndex={item === tab ? 0 : -1}
            className={item === tab ? "tab active" : "tab"}
            onClick={() => {
              setTab(item);
              setMessage(null);
            }}
            onKeyDown={(event) => {
              const next = nextTabIndex(event.key, index, tabs.length);
              if (next !== index) {
                event.preventDefault();
                refs.current[next]?.focus();
                setTab(tabs[next] ?? tab);
              }
            }}
          >
            {o.tabs[item]}
          </button>
        ))}
      </div>
      {message && (
        <p className="status" role="status" aria-live="polite">
          {message}
        </p>
      )}
      <section
        role="tabpanel"
        id={`operations-panel-${tabs.indexOf(tab)}`}
        aria-labelledby={`operations-tab-${tabs.indexOf(tab)}`}
      >
        {tab === "cash" && <CashPanel currency={currency} run={run} />}
        {tab === "people" && <PeoplePanel run={run} />}
        {tab === "offerings" && (
          <OfferingsPanel currency={currency} run={run} />
        )}
        {tab === "alerts" && <AlertsPanel />}
        {tab === "audit" && <AuditPanel />}
      </section>
    </AppShell>
  );
}

type Run = (work: () => Promise<unknown>, success: string) => Promise<void>;
function CashPanel({ currency, run }: { currency: Currency; run: Run }) {
  const t = useMessages();
  const c = t.operations.cash;
  const tills = useList<TillResponse>("tills");
  const sessions = useList<TillSessionResponse>("till-sessions");
  const [tillName, setTillName] = useState("");
  const [tillId, setTillId] = useState("");
  const [opening, setOpening] = useState("0");
  const { pending, run: runPending } = usePendingAction();
  const refresh = () => {
    tills.refresh();
    sessions.refresh();
  };
  const money = (value: number | null) =>
    value === null
      ? t.common.empty
      : formatMoney(value, currency.code, currency.minorUnits);
  const open =
    sessions.items?.filter((session) => session.status === "open") ?? [];
  const nameOf = (id: string) =>
    tills.items?.find((till) => till.id === id)?.name ?? id;
  return (
    <section className="ops-grid">
      <form
        className="panel ops-form"
        onSubmit={(event) => {
          event.preventDefault();
          void runPending("create-register", async () => {
            await run(
              () => post("tills", { name: tillName }),
              c.registerCreated,
            );
            setTillName("");
            refresh();
          });
        }}
      >
        <h2>{c.newRegister}</h2>
        <label htmlFor="till-name">{c.name}</label>
        <input
          id="till-name"
          name="till-name"
          value={tillName}
          onChange={(event) => setTillName(event.target.value)}
          required
        />
        <button disabled={pending === "create-register"}>
          {pending === "create-register" ? c.creating : c.createRegister}
        </button>
      </form>
      <form
        className="panel ops-form"
        onSubmit={(event) => {
          event.preventDefault();
          void runPending("open-session", async () => {
            await run(
              () =>
                post("till-sessions/open", {
                  tillId,
                  openingAmountMinor: parseMinorAmount(
                    opening,
                    currency.minorUnits,
                  ),
                }),
              c.sessionOpened,
            );
            refresh();
          });
        }}
      >
        <h2>{c.openSession}</h2>
        <label htmlFor="cash-register">{c.register}</label>
        <select
          id="cash-register"
          name="tillId"
          value={tillId}
          onChange={(event) => setTillId(event.target.value)}
          required
        >
          <option value="">{c.selectRegister}</option>
          {tills.items
            ?.filter((till) => till.enabled)
            .map((till) => (
              <option key={till.id} value={till.id}>
                {till.name}
              </option>
            ))}
        </select>
        <label htmlFor="opening">{c.openingAmount}</label>
        <input
          id="opening"
          name="opening"
          inputMode="decimal"
          type="number"
          min={0}
          step="any"
          value={opening}
          onChange={(event) => setOpening(event.target.value)}
          required
        />
        <button disabled={pending === "open-session"}>
          {pending === "open-session" ? c.opening : c.openSession}
        </button>
      </form>
      {open.map((session) => (
        <OpenSession
          key={session.id}
          session={session}
          tillName={nameOf(session.tillId)}
          currency={currency}
          run={run}
          onChange={refresh}
        />
      ))}
      <section className="panel ops-wide">
        <div className="section-head">
          <h2>{c.history}</h2>
          <button className="secondary-button" type="button" onClick={refresh}>
            {t.common.refresh}
          </button>
        </div>
        <ListState items={sessions.items} error={sessions.error} empty={c.empty}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{c.register}</th>
                  <th>{c.status}</th>
                  <th>{c.opened}</th>
                  <th className="numeric">{c.expected}</th>
                  <th className="numeric">{c.declared}</th>
                  <th className="numeric">{c.difference}</th>
                </tr>
              </thead>
              <tbody>
                {sessions.items?.map((session) => (
                  <tr key={session.id}>
                    <td>{nameOf(session.tillId)}</td>
                    <td>
                      <span className="status-badge">
                        {labelFor(t.codes.cashSessionStatus, session.status)}
                      </span>
                    </td>
                    <td>{formatDateTime(session.openedAt)}</td>
                    <td className="numeric">
                      {money(session.expectedAmountMinor)}
                    </td>
                    <td className="numeric">
                      {money(session.declaredAmountMinor)}
                    </td>
                    <td className="numeric">
                      {money(session.differenceMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ListState>
      </section>
    </section>
  );
}
function OpenSession({
  session,
  tillName,
  currency,
  run,
  onChange,
}: {
  session: TillSessionResponse;
  tillName: string;
  currency: Currency;
  run: Run;
  onChange: () => void;
}) {
  const t = useMessages();
  const c = t.operations.cash;
  const [kind, setKind] = useState<"in" | "out">("in");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [declared, setDeclared] = useState("");
  const [confirmation, setConfirmation] = useState(false);
  const [busy, setBusy] = useState(false);
  const { pending, run: runPending } = usePendingAction();
  const expected = session.expectedAmountMinor ?? session.openingAmountMinor;
  const close = async () => {
    setBusy(true);
    await run(
      () =>
        post(`till-sessions/${session.id}/close`, {
          declaredAmountMinor: parseMinorAmount(declared, currency.minorUnits),
        }),
      c.sessionClosed,
    );
    setBusy(false);
    setConfirmation(false);
    onChange();
  };
  return (
    <section className="panel ops-wide">
      <h2>{interpolate(c.openSessionTitle, { till: tillName })}</h2>
      <p>
        {c.expectedBalance}{" "}
        <strong>
          {formatMoney(expected, currency.code, currency.minorUnits)}
        </strong>{" "}
        ·{" "}
        {interpolate(
          session.operations.length === 1 ? c.operationsOne : c.operationsOther,
          { count: session.operations.length },
        )}
      </p>
      <div className="ops-grid">
        <form
          className="ops-form"
          onSubmit={(event) => {
            event.preventDefault();
            void runPending("record-operation", async () => {
              await run(
                () =>
                  post(`till-sessions/${session.id}/operations`, {
                    kind,
                    amountMinor: parseMinorAmount(amount, currency.minorUnits),
                    note: note || null,
                  }),
                c.operationRecorded,
              );
              setAmount("");
              setNote("");
              onChange();
            });
          }}
        >
          <label htmlFor={`kind-${session.id}`}>{c.type}</label>
          <select
            id={`kind-${session.id}`}
            value={kind}
            onChange={(event) => setKind(event.target.value as "in" | "out")}
          >
            <option value="in">{t.codes.movementKind.in}</option>
            <option value="out">{t.codes.movementKind.out}</option>
          </select>
          <label htmlFor={`amount-${session.id}`}>{c.amount}</label>
          <input
            id={`amount-${session.id}`}
            inputMode="decimal"
            type="number"
            min={0}
            step="any"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
          />
          <label htmlFor={`note-${session.id}`}>
            {c.note} <span className="optional">{t.common.optional}</span>
          </label>
          <input
            id={`note-${session.id}`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={240}
          />
          <button disabled={pending === "record-operation"}>
            {pending === "record-operation" ? c.recording : c.recordOperation}
          </button>
        </form>
        <form
          className="ops-form"
          onSubmit={(event) => {
            event.preventDefault();
            setConfirmation(true);
          }}
        >
          <label htmlFor={`declared-${session.id}`}>{c.countedAmount}</label>
          <input
            id={`declared-${session.id}`}
            inputMode="decimal"
            type="number"
            min={0}
            step="any"
            value={declared}
            onChange={(event) => setDeclared(event.target.value)}
            required
          />
          <button className="danger-button">{c.closeAndReconcile}</button>
        </form>
      </div>
      {confirmation && (
        <ConfirmationDialog
          title={c.closeTitle}
          description={c.closeDescription}
          confirmLabel={c.closeConfirm}
          busy={busy}
          onConfirm={() => void close()}
          onCancel={() => setConfirmation(false)}
        />
      )}
    </section>
  );
}
function PeoplePanel({ run }: { run: Run }) {
  const t = useMessages();
  const p = t.operations.people;
  const people = useList<Person>("people");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [roles, setRoles] = useState("");
  const { pending, run: runPending } = usePendingAction();
  return (
    <section className="ops-grid">
      <form
        className="panel ops-form"
        onSubmit={(event) => {
          event.preventDefault();
          void runPending("add-person", async () => {
            await run(
              () =>
                post("people", {
                  name,
                  contactIdentifier: contact.trim() || null,
                  roles: roles
                    .split(",")
                    .map((role) => role.trim())
                    .filter(Boolean),
                }),
              p.added,
            );
            setName("");
            setContact("");
            setRoles("");
            people.refresh();
          });
        }}
      >
        <h2>{p.add}</h2>
        <label htmlFor="person-name">{p.name}</label>
        <input
          id="person-name"
          name="name"
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <label htmlFor="person-contact">
          {p.contact} <span className="optional">{t.common.optional}</span>
        </label>
        <input
          id="person-contact"
          name="contact"
          autoComplete="email"
          value={contact}
          onChange={(event) => setContact(event.target.value)}
        />
        <label htmlFor="person-roles">{p.roles}</label>
        <input
          id="person-roles"
          name="roles"
          value={roles}
          onChange={(event) => setRoles(event.target.value)}
          aria-describedby="roles-help"
        />
        <small id="roles-help">{p.rolesHelp}</small>
        <button disabled={pending === "add-person"}>
          {pending === "add-person" ? p.adding : p.add}
        </button>
      </form>
      <RecordsTable
        title={p.title}
        records={people}
        headers={[p.name, p.status, p.contactColumn, p.roles]}
        rows={people.items?.map((person) => [
          person.name,
          labelFor(t.codes.recordStatus, person.status),
          person.contactIdentifier ?? t.common.empty,
          person.roles.join(", ") || t.common.empty,
        ])}
        empty={p.empty}
      />
    </section>
  );
}
function OfferingsPanel({ currency, run }: { currency: Currency; run: Run }) {
  const t = useMessages();
  const f = t.operations.offerings;
  const offerings = useList<Offering>("offerings");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [duration, setDuration] = useState("");
  const { pending, run: runPending } = usePendingAction();
  return (
    <section className="ops-grid">
      <form
        className="panel ops-form"
        onSubmit={(event) => {
          event.preventDefault();
          void runPending("add-offering", async () => {
            await run(
              () =>
                post("offerings", {
                  name,
                  priceMinor: price
                    ? parseMinorAmount(price, currency.minorUnits)
                    : null,
                  durationMinutes: duration ? Number(duration) : null,
                }),
              f.added,
            );
            setName("");
            setPrice("");
            setDuration("");
            offerings.refresh();
          });
        }}
      >
        <h2>{f.add}</h2>
        <label htmlFor="offering-name">{f.name}</label>
        <input
          id="offering-name"
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <label htmlFor="offering-price">
          {f.price} <span className="optional">{t.common.optional}</span>
        </label>
        <input
          id="offering-price"
          inputMode="decimal"
          type="number"
          min={0}
          step="any"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />
        <label htmlFor="offering-duration">
          {f.duration} <span className="optional">{t.common.optional}</span>
        </label>
        <input
          id="offering-duration"
          inputMode="numeric"
          type="number"
          min={1}
          step={1}
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
        />
        <button disabled={pending === "add-offering"}>
          {pending === "add-offering" ? f.adding : f.add}
        </button>
      </form>
      <RecordsTable
        title={f.title}
        records={offerings}
        headers={[f.name, f.status, f.price, f.durationColumn]}
        rows={offerings.items?.map((offering) => [
          offering.name,
          labelFor(t.codes.recordStatus, offering.status),
          offering.priceMinor === null
            ? t.common.empty
            : formatMoney(
                offering.priceMinor,
                currency.code,
                currency.minorUnits,
              ),
          offering.durationMinutes
            ? interpolate(t.common.minutes, {
                minutes: offering.durationMinutes,
              })
            : t.common.empty,
        ])}
        empty={f.empty}
      />
    </section>
  );
}
function RecordsTable({
  title,
  records,
  headers,
  rows,
  empty,
}: {
  title: string;
  records: ReturnType<typeof useList<unknown>>;
  headers: string[];
  rows?: string[][];
  empty: string;
}) {
  const t = useMessages();
  return (
    <section className="panel ops-wide">
      <div className="section-head">
        <h2>{title}</h2>
        <button
          className="secondary-button"
          type="button"
          onClick={records.refresh}
        >
          {t.common.refresh}
        </button>
      </div>
      <ListState items={records.items} error={records.error} empty={empty}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {headers.map((header) => (
                  <th key={header}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows?.map((row, index) => (
                <tr key={`${row[0]}-${index}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={headers[cellIndex]}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ListState>
    </section>
  );
}
function AlertsPanel() {
  const t = useMessages();
  const alerts = useList<Alert>("alerts");
  return (
    <section className="panel">
      <div className="section-head">
        <h2>{t.operations.alerts.title}</h2>
        <button
          className="secondary-button"
          type="button"
          onClick={alerts.refresh}
        >
          {t.common.refresh}
        </button>
      </div>
      <ListState
        items={alerts.items}
        error={alerts.error}
        empty={t.operations.alerts.empty}
      >
        <ul className="alert-list">
          {alerts.items?.map((alert) => (
            <li key={alert.id} className={`alert-item ${alert.severity}`}>
              <strong>{alertTitle(t, alert)}</strong>
              <span>{alertText(t, alert)}</span>
              <small>
                {entityReference(t, alert.entityType, alert.entityId)}
              </small>
            </li>
          ))}
        </ul>
      </ListState>
    </section>
  );
}
function AuditPanel() {
  const t = useMessages();
  const d = t.operations.audit;
  const events = useList<AuditEvent>("audit-events");
  return (
    <section className="panel">
      <div className="section-head">
        <h2>{d.title}</h2>
        <button
          className="secondary-button"
          type="button"
          onClick={events.refresh}
        >
          {t.common.refresh}
        </button>
      </div>
      <ListState items={events.items} error={events.error} empty={d.empty}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{d.when}</th>
                <th>{d.action}</th>
                <th>{d.entity}</th>
                <th>{d.actor}</th>
              </tr>
            </thead>
            <tbody>
              {events.items?.map((event) => (
                <tr key={event.id}>
                  <td>{formatDateTime(event.occurredAt)}</td>
                  <td>{labelFor(t.codes.auditAction, event.action)}</td>
                  <td>
                    {entityReference(t, event.entityType, event.entityId)}
                  </td>
                  <td>{event.actorId ?? t.common.system}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ListState>
    </section>
  );
}
