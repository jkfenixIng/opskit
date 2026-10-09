"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { interpolate, labelFor, useMessages } from "../i18n";
import { errorMessage } from "../i18n/errors";
import { formatCalendarDate, formatDateTime, formatPercent } from "../i18n/format";
import { paymentMethodLabel } from "../i18n/labels";
import { api, formatMoney } from "./api";
import { AppShell } from "./app-shell";
import { ConfirmationDialog } from "./confirmation-dialog";
import { parseMinorAmount } from "./money-input";
import { SignIn, useSession } from "./session";
import { nextTabIndex } from "./ui-helpers";
import { usePendingAction } from "./use-pending-action";

type Currency = { code: string; minorUnits: number };
type Person = { id: string; name: string };
type PaymentMethod = {
  code: string;
  label: string;
  enabled: boolean;
  requiresReference: boolean;
};
type Component =
  | { type: "fixed"; key: string; label: string; amountMinor: number }
  | {
      type: "percentage";
      key: string;
      label: string;
      basisPoints: number;
      base: "gross" | "net";
    };
type Plan = {
  id: string;
  name: string;
  components: Component[];
  rules: { type: string; amountMinor?: number }[];
};
type Assignment = { id: string; personId: string; planId: string };
type Period = {
  id: string;
  personId: string;
  schedule: { kind: string };
  startsOn: string;
  endsOn: string;
  status: "draft" | "calculated" | "closed";
};
type Item = {
  id: string;
  periodId: string;
  personId: string;
  netMinor: number;
  paidMinor: number;
};
type Advance = {
  id: string;
  personId: string;
  amountMinor: number;
  status: string;
  requestedAt: string;
  recoveredMinor: number;
};
type Payout = {
  id: string;
  itemId: string;
  amountMinor: number;
  methodCode: string;
  reference: string | null;
  recordedAt: string;
};
const tabs = ["plans", "periods", "advances", "payouts"] as const;
type Tab = (typeof tabs)[number];
const post = (path: string, body: unknown = {}) =>
  api(path, { method: "POST", body: JSON.stringify(body) });
const today = () => new Date().toISOString().slice(0, 10);
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
function DataState({
  records,
  empty,
  children,
}: {
  records: ReturnType<typeof useList<unknown>>;
  empty: string;
  children: React.ReactNode;
}) {
  const t = useMessages();
  if (records.error)
    return (
      <p className="table-state error" role="alert">
        {records.error}
      </p>
    );
  if (!records.items)
    return (
      <p className="table-state" aria-live="polite">
        {t.common.loading}
      </p>
    );
  if (!records.items.length)
    return <p className="table-state empty-state">{empty}</p>;
  return <>{children}</>;
}

type Run = (work: () => Promise<unknown>, success: string) => Promise<void>;
type Shared = { currency: Currency; people: Person[]; run: Run };
export function CompensationWorkspace() {
  const t = useMessages();
  const m = t.compensation;
  const { user, setUser, loading } = useSession();
  const [tab, setTab] = useState<Tab>("plans");
  const [currency, setCurrency] = useState<Currency>({
    code: "USD",
    minorUnits: 2,
  });
  const [people, setPeople] = useState<Person[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    if (!user) return;
    api<{ currency: Currency }>("dashboard")
      .then((data) => setCurrency(data.currency))
      .catch(() => undefined);
    api<Person[]>("people")
      .then(setPeople)
      .catch(() => setPeople([]));
  }, [user]);
  if (loading)
    return (
      <main className="standalone-state" aria-live="polite">
        {m.loading}
      </main>
    );
  if (!user) return <SignIn onSignedIn={setUser} />;
  const run: Run = async (work, success) => {
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
  const shared = { currency, people, run };
  return (
    <AppShell user={user} onSignOut={signOut}>
      <section className="page-header">
        <div>
          <p className="eyebrow">{m.eyebrow}</p>
          <h1>{m.title}</h1>
          <p>{m.description}</p>
        </div>
      </section>
      <div className="tabs" role="tablist" aria-label={m.tabsLabel}>
        {tabs.map((item, index) => (
          <button
            key={item}
            ref={(node) => {
              refs.current[index] = node;
            }}
            role="tab"
            id={`compensation-tab-${index}`}
            aria-selected={tab === item}
            aria-controls={`compensation-panel-${index}`}
            tabIndex={tab === item ? 0 : -1}
            className={tab === item ? "tab active" : "tab"}
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
            {m.tabs[item]}
          </button>
        ))}
      </div>
      {message && (
        <p role="status" aria-live="polite" className="status">
          {message}
        </p>
      )}
      <section
        role="tabpanel"
        id={`compensation-panel-${tabs.indexOf(tab)}`}
        aria-labelledby={`compensation-tab-${tabs.indexOf(tab)}`}
      >
        {tab === "plans" && <PlansPanel {...shared} />}
        {tab === "periods" && <PeriodsPanel {...shared} />}
        {tab === "advances" && <AdvancesPanel {...shared} />}
        {tab === "payouts" && <PayoutsPanel {...shared} />}
      </section>
    </AppShell>
  );
}
function PersonOptions({ people }: { people: Person[] }) {
  const t = useMessages();
  return (
    <>
      <option value="">{t.compensation.selectPerson}</option>
      {people.map((person) => (
        <option key={person.id} value={person.id}>
          {person.name}
        </option>
      ))}
    </>
  );
}
function PlansPanel({ currency, people, run }: Shared) {
  const t = useMessages();
  const p = t.compensation.plans;
  const plans = useList<Plan>("compensation/plans");
  const assignments = useList<Assignment>("compensation/assignments");
  const [name, setName] = useState("");
  const [fixed, setFixed] = useState("");
  const [rate, setRate] = useState("");
  const [base, setBase] = useState<"gross" | "net">("net");
  const [personId, setPersonId] = useState("");
  const [planId, setPlanId] = useState("");
  const { pending, run: runPending } = usePendingAction();
  const money = (amount: number) =>
    formatMoney(amount, currency.code, currency.minorUnits);
  const componentLabel = (component: Component) =>
    labelFor(p.componentLabels, component.key, component.label);
  return (
    <section className="ops-grid">
      <form
        className="panel ops-form"
        onSubmit={(event) => {
          event.preventDefault();
          const components: Component[] = [];
          // Stored component labels are API data; the UI shows them through `componentLabels`.
          if (fixed)
            components.push({
              type: "fixed",
              key: "base",
              label: "Fixed pay",
              amountMinor: parseMinorAmount(fixed, currency.minorUnits),
            });
          if (rate)
            components.push({
              type: "percentage",
              key: "commission",
              label: "Commission",
              basisPoints: parseMinorAmount(rate, 2),
              base,
            });
          void runPending("create-plan", async () => {
            await run(
              () => post("compensation/plans", { name, components, rules: [] }),
              p.created,
            );
            setName("");
            setFixed("");
            setRate("");
            plans.refresh();
          });
        }}
      >
        <h2>{p.newPlan}</h2>
        <label htmlFor="plan-name">{p.name}</label>
        <input
          id="plan-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <label htmlFor="plan-fixed">
          {p.fixed} <span className="optional">{t.common.optional}</span>
        </label>
        <input
          id="plan-fixed"
          inputMode="decimal"
          type="number"
          min={0}
          step="any"
          value={fixed}
          onChange={(event) => setFixed(event.target.value)}
        />
        <label htmlFor="plan-rate">
          {p.rate} <span className="optional">{t.common.optional}</span>
        </label>
        <input
          id="plan-rate"
          inputMode="decimal"
          type="number"
          min={0}
          max={100}
          step={0.01}
          value={rate}
          onChange={(event) => setRate(event.target.value)}
        />
        <label htmlFor="plan-base">{p.base}</label>
        <select
          id="plan-base"
          value={base}
          onChange={(event) => setBase(event.target.value as "gross" | "net")}
        >
          <option value="net">{t.codes.commissionBase.net}</option>
          <option value="gross">{t.codes.commissionBase.gross}</option>
        </select>
        <button disabled={pending === "create-plan"}>
          {pending === "create-plan" ? p.creating : p.create}
        </button>
      </form>
      <form
        className="panel ops-form"
        onSubmit={(event) => {
          event.preventDefault();
          void runPending("assign-plan", async () => {
            await run(
              () =>
                post("compensation/assignments", {
                  personId,
                  planId,
                  startsOn: today(),
                }),
              p.assigned,
            );
            assignments.refresh();
          });
        }}
      >
        <h2>{p.assign}</h2>
        <label htmlFor="assignment-person">{t.compensation.person}</label>
        <select
          id="assignment-person"
          value={personId}
          onChange={(event) => setPersonId(event.target.value)}
          required
        >
          <PersonOptions people={people} />
        </select>
        <label htmlFor="assignment-plan">{p.plan}</label>
        <select
          id="assignment-plan"
          value={planId}
          onChange={(event) => setPlanId(event.target.value)}
          required
        >
          <option value="">{p.selectPlan}</option>
          {plans.items?.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.name}
            </option>
          ))}
        </select>
        <button disabled={pending === "assign-plan"}>
          {pending === "assign-plan" ? p.assigning : p.assign}
        </button>
      </form>
      <section className="panel ops-wide">
        <div className="section-head">
          <h2>{p.title}</h2>
          <button
            type="button"
            className="secondary-button"
            onClick={plans.refresh}
          >
            {t.common.refresh}
          </button>
        </div>
        <DataState records={plans} empty={p.empty}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{p.name}</th>
                  <th>{p.components}</th>
                  <th>{p.assignedTo}</th>
                </tr>
              </thead>
              <tbody>
                {plans.items?.map((plan) => (
                  <tr key={plan.id}>
                    <td>{plan.name}</td>
                    <td>
                      {plan.components
                        .map((component) =>
                          component.type === "fixed"
                            ? interpolate(p.fixedComponent, {
                                label: componentLabel(component),
                                amount: money(component.amountMinor),
                              })
                            : interpolate(p.percentageComponent, {
                                label: componentLabel(component),
                                rate: formatPercent(component.basisPoints / 10_000),
                                base: labelFor(
                                  t.codes.commissionBase,
                                  component.base,
                                ),
                              }),
                        )
                        .join(" · ") || t.common.empty}
                    </td>
                    <td>
                      {assignments.items
                        ?.filter((assignment) => assignment.planId === plan.id)
                        .map(
                          (assignment) =>
                            people.find(
                              (person) => person.id === assignment.personId,
                            )?.name ?? assignment.personId,
                        )
                        .join(", ") || t.common.empty}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
      </section>
    </section>
  );
}
function PeriodsPanel({ currency, people, run }: Shared) {
  const t = useMessages();
  const p = t.compensation.periods;
  const periods = useList<Period>("compensation/pay-periods");
  const items = useList<Item>("compensation/items");
  const [personId, setPersonId] = useState("");
  const [confirmation, setConfirmation] = useState<Period | null>(null);
  const [busy, setBusy] = useState(false);
  const { pending, run: runPending } = usePendingAction();
  const refresh = () => {
    periods.refresh();
    items.refresh();
  };
  const money = (amount: number) =>
    formatMoney(amount, currency.code, currency.minorUnits);
  const close = async () => {
    if (!confirmation) return;
    setBusy(true);
    await run(
      () => post(`compensation/pay-periods/${confirmation.id}/close`),
      p.closed,
    );
    setBusy(false);
    setConfirmation(null);
    refresh();
  };
  return (
    <section className="ops-grid">
      <form
        className="panel ops-form"
        onSubmit={(event) => {
          event.preventDefault();
          void runPending("create-period", async () => {
            await run(
              () =>
                post("compensation/pay-periods", {
                  personId,
                  schedule: { kind: "monthly", startDayOfMonth: 1 },
                  containingDate: today(),
                }),
              p.created,
            );
            refresh();
          });
        }}
      >
        <h2>{p.newPeriod}</h2>
        <p className="form-hint">{p.hint}</p>
        <label htmlFor="period-person">{t.compensation.person}</label>
        <select
          id="period-person"
          value={personId}
          onChange={(event) => setPersonId(event.target.value)}
          required
        >
          <PersonOptions people={people} />
        </select>
        <button disabled={pending === "create-period"}>
          {pending === "create-period" ? p.creating : p.create}
        </button>
      </form>
      <section className="panel ops-wide">
        <div className="section-head">
          <h2>{p.title}</h2>
          <button type="button" className="secondary-button" onClick={refresh}>
            {t.common.refresh}
          </button>
        </div>
        <DataState records={periods} empty={p.empty}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t.compensation.person}</th>
                  <th>{p.cadence}</th>
                  <th>{p.window}</th>
                  <th>{p.status}</th>
                  <th className="numeric">{p.net}</th>
                  <th>{p.actions}</th>
                </tr>
              </thead>
              <tbody>
                {periods.items?.map((period) => {
                  const item = items.items?.find(
                    (candidate) => candidate.periodId === period.id,
                  );
                  return (
                    <tr key={period.id}>
                      <td>
                        {people.find((person) => person.id === period.personId)
                          ?.name ?? period.personId}
                      </td>
                      <td>{labelFor(t.codes.cadence, period.schedule.kind)}</td>
                      <td>
                        {interpolate(t.common.dateRange, {
                          start: formatCalendarDate(period.startsOn),
                          end: formatCalendarDate(period.endsOn),
                        })}
                      </td>
                      <td>
                        <span className="status-badge">
                          {labelFor(t.codes.payPeriodStatus, period.status)}
                        </span>
                      </td>
                      <td className="numeric">
                        {item ? money(item.netMinor) : t.common.empty}
                      </td>
                      <td className="row-actions">
                        {period.status !== "closed" && (
                          <button
                            type="button"
                            onClick={() =>
                              void runPending(
                                `calculate-${period.id}`,
                                async () => {
                                  await run(
                                    () =>
                                      post(
                                        `compensation/pay-periods/${period.id}/calculate`,
                                      ),
                                    p.calculated,
                                  );
                                  refresh();
                                },
                              )
                            }
                            disabled={pending === `calculate-${period.id}`}
                          >
                            {pending === `calculate-${period.id}`
                              ? p.calculating
                              : period.status === "draft"
                                ? p.calculate
                                : p.recalculate}
                          </button>
                        )}
                        {period.status === "calculated" && (
                          <button
                            type="button"
                            className="danger-button"
                            onClick={() => setConfirmation(period)}
                          >
                            {p.close}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </DataState>
      </section>
      {confirmation && (
        <ConfirmationDialog
          title={p.closeTitle}
          description={p.closeDescription}
          confirmLabel={p.closeConfirm}
          busy={busy}
          onConfirm={() => void close()}
          onCancel={() => setConfirmation(null)}
        />
      )}
    </section>
  );
}
function AdvancesPanel({ currency, people, run }: Shared) {
  const t = useMessages();
  const a = t.compensation.advances;
  const advances = useList<Advance>("compensation/advances");
  const [personId, setPersonId] = useState("");
  const [amount, setAmount] = useState("");
  const [decision, setDecision] = useState<{
    advance: Advance;
    action: "approve" | "reject";
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const { pending, run: runPending } = usePendingAction();
  const money = (value: number) =>
    formatMoney(value, currency.code, currency.minorUnits);
  const decide = async () => {
    if (!decision) return;
    setBusy(true);
    await run(
      () =>
        post(`compensation/advances/${decision.advance.id}/${decision.action}`),
      decision.action === "approve" ? a.approved : a.rejected,
    );
    setBusy(false);
    setDecision(null);
    advances.refresh();
  };
  return (
    <section className="ops-grid">
      <form
        className="panel ops-form"
        onSubmit={(event) => {
          event.preventDefault();
          void runPending("request-advance", async () => {
            await run(
              () =>
                post("compensation/advances", {
                  personId,
                  amountMinor: parseMinorAmount(amount, currency.minorUnits),
                  note: null,
                }),
              a.requested,
            );
            setAmount("");
            advances.refresh();
          });
        }}
      >
        <h2>{a.request}</h2>
        <p className="form-hint">{a.hint}</p>
        <label htmlFor="advance-person">{t.compensation.person}</label>
        <select
          id="advance-person"
          value={personId}
          onChange={(event) => setPersonId(event.target.value)}
          required
        >
          <PersonOptions people={people} />
        </select>
        <label htmlFor="advance-amount">{a.amount}</label>
        <input
          id="advance-amount"
          inputMode="decimal"
          type="number"
          min={0}
          step="any"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          required
        />
        <button disabled={pending === "request-advance"}>
          {pending === "request-advance" ? a.requesting : a.request}
        </button>
      </form>
      <section className="panel ops-wide">
        <div className="section-head">
          <h2>{a.title}</h2>
          <button
            type="button"
            className="secondary-button"
            onClick={advances.refresh}
          >
            {t.common.refresh}
          </button>
        </div>
        <DataState records={advances} empty={a.empty}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t.compensation.person}</th>
                  <th>{a.requestedAt}</th>
                  <th className="numeric">{a.amount}</th>
                  <th className="numeric">{a.recovered}</th>
                  <th>{a.status}</th>
                  <th>{a.actions}</th>
                </tr>
              </thead>
              <tbody>
                {advances.items?.map((advance) => (
                  <tr key={advance.id}>
                    <td>
                      {people.find((person) => person.id === advance.personId)
                        ?.name ?? advance.personId}
                    </td>
                    <td>{formatDateTime(advance.requestedAt)}</td>
                    <td className="numeric">{money(advance.amountMinor)}</td>
                    <td className="numeric">{money(advance.recoveredMinor)}</td>
                    <td>
                      <span className="status-badge">
                        {labelFor(t.codes.advanceStatus, advance.status)}
                      </span>
                    </td>
                    <td className="row-actions">
                      {advance.status === "requested" && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              setDecision({ advance, action: "approve" })
                            }
                          >
                            {a.approve}
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() =>
                              setDecision({ advance, action: "reject" })
                            }
                          >
                            {a.reject}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
      </section>
      {decision && (
        <ConfirmationDialog
          title={decision.action === "approve" ? a.approveTitle : a.rejectTitle}
          description={interpolate(
            decision.action === "approve"
              ? a.approveDescription
              : a.rejectDescription,
            { amount: money(decision.advance.amountMinor) },
          )}
          confirmLabel={decision.action === "approve" ? a.approve : a.reject}
          busy={busy}
          onConfirm={() => void decide()}
          onCancel={() => setDecision(null)}
        />
      )}
    </section>
  );
}
function PayoutsPanel({ currency, people, run }: Shared) {
  const t = useMessages();
  const p = t.compensation.payouts;
  const items = useList<Item>("compensation/items");
  const periods = useList<Period>("compensation/pay-periods");
  const payouts = useList<Payout>("compensation/payouts");
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [itemId, setItemId] = useState("");
  const [amount, setAmount] = useState("");
  const [methodCode, setMethodCode] = useState("");
  const [reference, setReference] = useState("");
  const [confirmation, setConfirmation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );
  useEffect(() => {
    api<{ paymentMethods: PaymentMethod[] }>("settings")
      .then((settings) =>
        setMethods(settings.paymentMethods.filter((method) => method.enabled)),
      )
      .catch(() => setMethods([]));
  }, []);
  const closed = new Set(
    periods.items
      ?.filter((period) => period.status === "closed")
      .map((period) => period.id),
  );
  const payable =
    items.items?.filter(
      (item) => closed.has(item.periodId) && item.paidMinor < item.netMinor,
    ) ?? [];
  const money = (value: number) =>
    formatMoney(value, currency.code, currency.minorUnits);
  const methodLabel = (code: string) =>
    paymentMethodLabel(t, methods.find((method) => method.code === code) ?? { code });
  const commit = async () => {
    setBusy(true);
    await run(
      () =>
        post("compensation/payouts", {
          itemId,
          amountMinor: parseMinorAmount(amount, currency.minorUnits),
          methodCode,
          reference: reference.trim() || null,
          idempotencyKey,
        }),
      p.recorded,
    );
    setBusy(false);
    setConfirmation(false);
    setAmount("");
    setReference("");
    setIdempotencyKey(crypto.randomUUID());
    items.refresh();
    payouts.refresh();
  };
  return (
    <section className="ops-grid">
      <form
        className="panel ops-form"
        onSubmit={(event) => {
          event.preventDefault();
          setConfirmation(true);
        }}
      >
        <h2>{p.record}</h2>
        <label htmlFor="payout-item">{p.item}</label>
        <select
          id="payout-item"
          value={itemId}
          onChange={(event) => setItemId(event.target.value)}
          required
        >
          <option value="">{p.selectItem}</option>
          {payable.map((item) => (
            <option key={item.id} value={item.id}>
              {interpolate(p.itemOption, {
                name:
                  people.find((person) => person.id === item.personId)?.name ??
                  item.personId,
                amount: money(item.netMinor - item.paidMinor),
              })}
            </option>
          ))}
        </select>
        <label htmlFor="payout-amount">{p.amount}</label>
        <input
          id="payout-amount"
          inputMode="decimal"
          type="number"
          min={0}
          step="any"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          required
        />
        <label htmlFor="payout-method">{p.method}</label>
        <select
          id="payout-method"
          value={methodCode}
          onChange={(event) => setMethodCode(event.target.value)}
          required
        >
          <option value="">{p.selectMethod}</option>
          {methods.map((method) => (
            <option key={method.code} value={method.code}>
              {paymentMethodLabel(t, method)}
            </option>
          ))}
        </select>
        <label htmlFor="payout-reference">
          {p.reference}{" "}
          <span className="optional">{t.common.optionalWhenAllowed}</span>
        </label>
        <input
          id="payout-reference"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          maxLength={120}
        />
        <button className="danger-button">{p.record}</button>
      </form>
      <section className="panel ops-wide">
        <div className="section-head">
          <h2>{p.history}</h2>
          <button
            type="button"
            className="secondary-button"
            onClick={payouts.refresh}
          >
            {t.common.refresh}
          </button>
        </div>
        <DataState records={payouts} empty={p.empty}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{p.when}</th>
                  <th>{p.amount}</th>
                  <th>{p.method}</th>
                  <th>{p.reference}</th>
                </tr>
              </thead>
              <tbody>
                {payouts.items?.map((payout) => (
                  <tr key={payout.id}>
                    <td>{formatDateTime(payout.recordedAt)}</td>
                    <td className="numeric">{money(payout.amountMinor)}</td>
                    <td>{methodLabel(payout.methodCode)}</td>
                    <td>{payout.reference ?? t.common.empty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
      </section>
      {confirmation && (
        <ConfirmationDialog
          title={p.confirmTitle}
          description={p.confirmDescription}
          confirmLabel={p.record}
          busy={busy}
          onConfirm={() => void commit()}
          onCancel={() => setConfirmation(false)}
        />
      )}
    </section>
  );
}
