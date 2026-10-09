import { z } from 'zod';

export const roleSchema = z.enum(['owner', 'manager', 'staff', 'viewer']);
export const permissionSchema = z.enum(['dashboard:read', 'settings:read', 'settings:write', 'inventory:read', 'inventory:write', 'invoices:read', 'invoices:write', 'payments:write', 'cash:read', 'cash:write', 'people:read', 'people:write', 'offerings:read', 'offerings:write', 'audit:read', 'compensation:read', 'compensation:write', 'compensation:approve']);
export const moduleKeySchema = z.enum(['dashboard', 'inventory', 'invoicing', 'settings', 'cash', 'people', 'offerings', 'audit', 'compensation']);
export const paymentMethodSchema = z.object({ code: z.string().min(1).max(32), label: z.string().min(1).max(80), enabled: z.boolean(), requiresReference: z.boolean(), feeBasisPoints: z.number().int().min(0).max(10_000) });
const minorAmount = z.number().int().safe().min(0);
const positiveMinorAmount = z.number().int().safe().min(1);
const basisPoints = z.number().int().min(0).max(10_000);
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const compensationPolicySchema = z.object({
  rounding: z.object({ mode: z.enum(['halfUp', 'halfEven', 'down', 'up']), increment: z.enum(['minor', 'major']) }),
  immediateCommission: z.boolean(),
  advances: z.object({ maxPerRequestMinor: minorAmount.nullable(), maxPerPeriodMinor: minorAmount.nullable(), maxShareOfEstimatedEarningsBasisPoints: basisPoints.nullable(), outstandingBalancePolicy: z.enum(['carryOver', 'block']) }),
  payouts: z.object({ allowPartial: z.boolean() }),
});
export const defaultCompensationPolicyInput = { rounding: { mode: 'halfUp', increment: 'minor' }, immediateCommission: false, advances: { maxPerRequestMinor: null, maxPerPeriodMinor: null, maxShareOfEstimatedEarningsBasisPoints: null, outstandingBalancePolicy: 'carryOver' }, payouts: { allowPartial: true } } as const;
export const organizationSettingsSchema = z.object({ name: z.string().min(1).max(120), currency: z.object({ code: z.string().length(3), minorUnits: z.number().int().min(0).max(4) }), timeZone: z.string().min(1), paymentMethods: z.array(paymentMethodSchema).min(1), modules: z.array(z.object({ key: moduleKeySchema, label: z.string().min(1), enabled: z.boolean() })), operations: z.object({ inventory: z.object({ allowNegativeStock: z.boolean(), defaultLowStockThreshold: z.number().int().min(0) }), invoicing: z.object({ allowPartialPayments: z.boolean(), defaultTaxRateBasisPoints: z.number().int().min(0).max(10_000), numberPrefix: z.string().trim().min(1).max(40), numberPadding: z.number().int().min(1).max(20) }), compensation: compensationPolicySchema.default(defaultCompensationPolicyInput) }), accessPolicy: z.record(roleSchema, z.array(permissionSchema)) });
export const updateSettingsSchema = organizationSettingsSchema;
export const createProductSchema = z.object({ sku: z.string().min(1).max(64), name: z.string().min(1).max(120), stock: z.number().int().min(0).default(0), lowStockThreshold: z.number().int().min(0).nullable().default(null) });
export const stockMovementSchema = z.object({ kind: z.enum(['in', 'out', 'adjustment']), quantity: z.number().int().min(1), note: z.string().max(240).nullable().default(null) });
export const invoiceLineSchema = z.object({ description: z.string().min(1).max(240), quantity: z.number().int().safe().min(1), unitPriceMinor: minorAmount, performerId: z.string().min(1).max(120).nullable().default(null) });
export const createInvoiceSchema = z.object({ customerName: z.string().max(120).nullable().default(null), lines: z.array(invoiceLineSchema).min(1), taxRateBasisPoints: z.number().int().min(0).max(10_000).optional() });
export const paymentSchema = z.object({ methodCode: z.string().min(1).max(32), amountMinor: positiveMinorAmount, reference: z.string().max(120).nullable().default(null) });
export const createPersonSchema = z.object({ name: z.string().min(1).max(120), status: z.enum(['active', 'inactive']).default('active'), contactIdentifier: z.string().max(120).nullable().default(null), roles: z.array(z.string().min(1).max(80)).default([]) });
export const createOfferingSchema = z.object({ name: z.string().min(1).max(120), status: z.enum(['active', 'inactive']).default('active'), priceMinor: minorAmount.nullable().default(null), durationMinutes: z.number().int().min(1).nullable().default(null) });
export const createTillSchema = z.object({ name: z.string().min(1).max(120), enabled: z.boolean().default(true) });
export const openTillSessionSchema = z.object({ tillId: z.string().min(1), openingAmountMinor: minorAmount });
export const tillOperationSchema = z.object({ kind: z.enum(['in', 'out']), amountMinor: positiveMinorAmount, note: z.string().max(240).nullable().default(null) });
export const closeTillSessionSchema = z.object({ declaredAmountMinor: minorAmount });
export const currencyResponseSchema = z.object({ code: z.string().length(3), minorUnits: z.number().int().min(0).max(4) });
export const tillResponseSchema = z.object({ id: z.string(), name: z.string(), enabled: z.boolean() });
export const tillOperationResponseSchema = z.object({ id: z.string(), sessionId: z.string(), kind: z.enum(['in', 'out']), amountMinor: z.number().int(), note: z.string().nullable(), recordedAt: z.string(), actorId: z.string() });
export const tillSessionResponseSchema = z.object({ id: z.string(), tillId: z.string(), status: z.enum(['open', 'closed']), openingAmountMinor: z.number().int(), expectedAmountMinor: z.number().int().nullable(), declaredAmountMinor: z.number().int().nullable(), differenceMinor: z.number().int().nullable(), openedAt: z.string(), closedAt: z.string().nullable(), operations: z.array(tillOperationResponseSchema) });
export const dashboardResponseSchema = z.object({ currency: currencyResponseSchema, metrics: z.object({ products: z.number().int(), lowStock: z.number().int(), openInvoices: z.number().int(), collectedMinor: z.number().int() }), products: z.array(z.object({ id: z.string(), sku: z.string(), name: z.string(), stock: z.number().int(), lowStockThreshold: z.number().int().nullable(), updatedAt: z.string() })), invoices: z.array(z.object({ id: z.string(), number: z.string(), status: z.enum(['open', 'paid', 'void']), currency: z.string(), customerName: z.string().nullable(), lines: z.array(invoiceLineSchema), subtotalMinor: z.number().int(), taxMinor: z.number().int(), totalMinor: z.number().int(), paidMinor: z.number().int(), issuedAt: z.string() })), modules: z.array(z.object({ key: moduleKeySchema, label: z.string(), enabled: z.boolean() })) });

const componentKey = z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/, 'Use letters, digits, dashes or underscores');
// Component and rule settings are owned by the strategy registered for their `type`; the contract only fixes the envelope.
export const planComponentSchema = z.looseObject({ type: z.string().min(1).max(80), key: componentKey, label: z.string().min(1).max(80) });
export const planRuleSchema = z.looseObject({ type: z.string().min(1).max(80) });
export const createCompensationPlanSchema = z.object({ name: z.string().min(1).max(120), components: z.array(planComponentSchema).min(1).max(20), rules: z.array(planRuleSchema).max(10).default([]) });
/** Returns the reason a component or rule is invalid for its registered strategy, or null when it is valid. */
export type PlanStrategyValidator = {
  component(component: z.infer<typeof planComponentSchema>): string | null;
  rule(rule: z.infer<typeof planRuleSchema>): string | null;
};
/** Plan contract bound to the strategies registered at composition time: unknown types and invalid settings become 400 issues. */
export function compensationPlanSchemaFor(validator: PlanStrategyValidator) {
  return createCompensationPlanSchema.superRefine((plan, context) => {
    plan.components.forEach((component, index) => {
      const message = validator.component(component);
      if (message) context.addIssue({ code: 'custom', path: ['components', index], message });
    });
    plan.rules.forEach((rule, index) => {
      const message = validator.rule(rule);
      if (message) context.addIssue({ code: 'custom', path: ['rules', index], message });
    });
  });
}
export const assignCompensationPlanSchema = z.object({ personId: z.string().min(1), planId: z.string().min(1), startsOn: calendarDate, endsOn: calendarDate.nullable().default(null) });
export const payScheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('weekly'), startWeekday: z.number().int().min(0).max(6) }),
  z.object({ kind: z.literal('biweekly'), anchorDate: calendarDate }),
  z.object({ kind: z.literal('monthly'), startDayOfMonth: z.number().int().min(1).max(28) }),
  z.object({ kind: z.literal('customDays'), days: z.number().int().min(1).max(366), anchorDate: calendarDate }),
]);
export const createPayPeriodSchema = z.object({ personId: z.string().min(1), schedule: payScheduleSchema, containingDate: calendarDate });
export const requestAdvanceSchema = z.object({ personId: z.string().min(1), amountMinor: positiveMinorAmount, note: z.string().max(240).nullable().default(null) });
export const recordPayoutSchema = z.object({ itemId: z.string().min(1), amountMinor: positiveMinorAmount, methodCode: z.string().min(1).max(32), reference: z.string().max(120).nullable().default(null), idempotencyKey: z.string().min(8).max(120) });

export type OrganizationSettingsInput = z.input<typeof organizationSettingsSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type StockMovementInput = z.infer<typeof stockMovementSchema>;
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;
export type CompensationPlanInput = z.input<typeof createCompensationPlanSchema>;
export type PayScheduleInput = z.infer<typeof payScheduleSchema>;
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
export type TillResponse = z.infer<typeof tillResponseSchema>;
export type TillSessionResponse = z.infer<typeof tillSessionResponseSchema>;
