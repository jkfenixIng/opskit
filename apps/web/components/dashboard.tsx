"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { interpolate, labelFor, useMessages } from "../i18n";
import { errorMessage } from "../i18n/errors";
import { formatNumber } from "../i18n/format";
import { api, formatMoney } from "./api";
import { AppShell } from "./app-shell";
import { SignIn, type SessionUser, useSession } from "./session";

type DashboardData = {
  currency: { code: string; minorUnits: number };
  metrics: {
    products: number;
    lowStock: number;
    openInvoices: number;
    collectedMinor: number;
  };
  products: {
    id: string;
    sku: string;
    name: string;
    stock: number;
    lowStockThreshold: number | null;
  }[];
  invoices: {
    id: string;
    number: string;
    customerName: string | null;
    totalMinor: number;
    paidMinor: number;
    status: string;
  }[];
  modules: { key: string; label: string; enabled: boolean }[];
};

export function Dashboard() {
  const t = useMessages();
  const { user, setUser, loading } = useSession();
  if (loading)
    return (
      <main className="standalone-state" aria-live="polite">
        {t.dashboard.loading}
      </main>
    );
  if (!user) return <SignIn onSignedIn={setUser} />;
  return <Workspace user={user} onSignedOut={() => setUser(null)} />;
}

function Workspace({
  user,
  onSignedOut,
}: {
  user: SessionUser;
  onSignedOut: () => void;
}) {
  const t = useMessages();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<DashboardData>("dashboard")
      .then(setData)
      .catch((reason) => setError(errorMessage(reason, t.dashboard.loadFailed)));
  }, [t]);
  const signOut = async () => {
    await api<void>("auth/logout", { method: "POST" });
    onSignedOut();
  };
  return (
    <AppShell user={user} onSignOut={signOut}>
      <section className="page-header">
        <div>
          <p className="eyebrow">{t.dashboard.eyebrow}</p>
          <h1>{t.dashboard.title}</h1>
          <p>{t.dashboard.description}</p>
        </div>
        <Link className="button-link" href="/operations">
          {t.dashboard.openOperations}
        </Link>
      </section>
      {error ? (
        <section className="state-panel" role="alert">
          <h2>{t.dashboard.unavailable}</h2>
          <p>{error}</p>
          <button onClick={() => location.reload()}>{t.common.tryAgain}</button>
        </section>
      ) : !data ? (
        <DashboardSkeleton />
      ) : (
        <DashboardContent data={data} />
      )}
    </AppShell>
  );
}

function DashboardContent({ data }: { data: DashboardData }) {
  const t = useMessages();
  const { attention: a, metrics: m, invoices: inv } = t.dashboard;
  const attention = [
    {
      key: "low-stock",
      label: a.lowStock,
      value: data.metrics.lowStock,
      detail: a.lowStockDetail,
      href: "#stock",
    },
    {
      key: "open-invoices",
      label: a.openInvoices,
      value: data.metrics.openInvoices,
      detail: a.openInvoicesDetail,
      href: "#invoices",
    },
    {
      key: "active-cash",
      label: a.activeCash,
      value: null,
      detail: a.activeCashDetail,
      href: "/operations",
    },
  ];
  return (
    <>
      <section className="metric-grid" aria-label={t.dashboard.metricsLabel}>
        <Metric
          label={m.products}
          value={formatNumber(data.metrics.products)}
          hint={m.productsHint}
        />
        <Metric
          label={m.lowStock}
          value={formatNumber(data.metrics.lowStock)}
          hint={m.lowStockHint}
          alert={data.metrics.lowStock > 0}
        />
        <Metric
          label={m.openInvoices}
          value={formatNumber(data.metrics.openInvoices)}
          hint={m.openInvoicesHint}
          alert={data.metrics.openInvoices > 0}
        />
        <Metric
          label={m.collected}
          value={formatMoney(
            data.metrics.collectedMinor,
            data.currency.code,
            data.currency.minorUnits,
          )}
          hint={m.collectedHint}
        />
      </section>
      <section className="content-grid">
        <section className="panel attention-queue">
          <div className="section-head">
            <div>
              <p className="eyebrow">{a.eyebrow}</p>
              <h2>{a.title}</h2>
            </div>
          </div>
          <ul>
            {attention.map((item) => (
              <li key={item.key}>
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.detail}</span>
                </div>
                <Link href={item.href}>
                  {item.value === null
                    ? a.review
                    : interpolate(item.value === 1 ? a.itemsOne : a.itemsOther, {
                        count: formatNumber(item.value),
                      })}
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <section id="stock" className="panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">{t.dashboard.stock.eyebrow}</p>
              <h2>{t.dashboard.stock.title}</h2>
            </div>
          </div>
          <StockChart products={data.products} />
        </section>
      </section>
      <section id="invoices" className="panel">
        <div className="section-head">
          <div>
            <p className="eyebrow">{inv.eyebrow}</p>
            <h2>{inv.title}</h2>
          </div>
          <Link href="/operations">{inv.manage}</Link>
        </div>
        {data.invoices.length === 0 ? (
          <p className="empty-state">{inv.empty}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{inv.invoice}</th>
                  <th>{inv.customer}</th>
                  <th>{inv.status}</th>
                  <th className="numeric">{inv.outstanding}</th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>{invoice.number}</td>
                    <td>{invoice.customerName ?? t.common.empty}</td>
                    <td>
                      <span className="status-badge">
                        {labelFor(t.codes.invoiceStatus, invoice.status)}
                      </span>
                    </td>
                    <td className="numeric">
                      {formatMoney(
                        invoice.totalMinor - invoice.paidMinor,
                        data.currency.code,
                        data.currency.minorUnits,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function DashboardSkeleton() {
  const t = useMessages();
  return (
    <>
      <section
        className="metric-grid"
        aria-label={t.dashboard.loadingMetricsLabel}
      >
        {[1, 2, 3, 4].map((key) => (
          <div className="metric skeleton" key={key} />
        ))}
      </section>
      <section className="panel skeleton-panel" aria-live="polite">
        {t.dashboard.loadingData}
      </section>
    </>
  );
}
function StockChart({ products }: { products: DashboardData["products"] }) {
  const t = useMessages();
  const s = t.dashboard.stock;
  if (products.length === 0) return <p className="empty-state">{s.empty}</p>;
  const max = Math.max(
    1,
    ...products.map((product) =>
      Math.max(product.stock, product.lowStockThreshold ?? 0),
    ),
  );
  return (
    <figure className="chart">
      <ul>
        {products.map((product) => {
          const threshold = product.lowStockThreshold;
          const low = threshold !== null && product.stock <= threshold;
          const label =
            interpolate(s.barLabel, {
              name: product.name,
              stock: formatNumber(product.stock),
            }) +
            (threshold === null
              ? ""
              : interpolate(s.barThreshold, { threshold: formatNumber(threshold) }));
          return (
            <li key={product.id}>
              <span className="chart-label">{product.name}</span>
              <span className="chart-track" aria-label={label}>
                <span
                  className={low ? "chart-bar low" : "chart-bar"}
                  style={{ width: `${(product.stock / max) * 100}%` }}
                />
                {threshold !== null && (
                  <span
                    className="chart-threshold"
                    style={{ left: `${(threshold / max) * 100}%` }}
                  />
                )}
              </span>
              <span className="chart-value">{formatNumber(product.stock)}</span>
            </li>
          );
        })}
      </ul>
      <figcaption>{s.caption}</figcaption>
    </figure>
  );
}
function Metric({
  label,
  value,
  hint,
  alert = false,
}: {
  label: string;
  value: string;
  hint: string;
  alert?: boolean;
}) {
  return (
    <article className={alert ? "metric alert" : "metric"}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}
