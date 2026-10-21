import { ActionForm } from "@/components/ActionForm";
import { Field, btnSecondary, inputCls } from "@/components/ui";
import { adjustmentAction, chargeAction, recordPaymentAction } from "@/app/billing/actions";
import { formatDayISO, today } from "@/lib/dates";

type Option = { id: string; name: string };

function PayerSelect({ payers }: { payers: Option[] }) {
  return (
    <Field label="Payer">
      <select name="payerId" required className={inputCls}>
        {payers.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    </Field>
  );
}

export function PaymentForm({ payers, returnPath }: { payers: Option[]; returnPath?: string }) {
  return (
    <ActionForm action={recordPaymentAction} submitLabel="Record payment" className="grid gap-3 sm:grid-cols-2">
      {returnPath && <input type="hidden" name="returnPath" value={returnPath} />}
      <PayerSelect payers={payers} />
      <Field label="Amount"><input name="amount" inputMode="decimal" placeholder="0.00" required className={inputCls} /></Field>
      <Field label="Method">
        <select name="method" className={inputCls}>
          <option value="CARD">Card</option>
          <option value="ACH">ACH / bank</option>
          <option value="CHECK">Check</option>
          <option value="CASH">Cash</option>
          <option value="SUBSIDY">Subsidy remittance</option>
        </select>
      </Field>
      <Field label="Received"><input name="receivedAt" type="date" defaultValue={formatDayISO(today())} className={inputCls} /></Field>
      <Field label="Reference"><input name="reference" placeholder="Check #, processor id…" className={inputCls} /></Field>
      <Field label="Processor fee" hint="Leave blank to use your card/ACH rates">
        <input name="fee" inputMode="decimal" placeholder="auto" className={inputCls} />
      </Field>
    </ActionForm>
  );
}

export function ChargeForm({ payers, accounts, returnPath }: { payers: Option[]; accounts: Option[]; returnPath?: string }) {
  return (
    <ActionForm action={chargeAction} submitLabel="Create invoice" className="grid gap-3 sm:grid-cols-2">
      {returnPath && <input type="hidden" name="returnPath" value={returnPath} />}
      <PayerSelect payers={payers} />
      <Field label="Amount"><input name="amount" inputMode="decimal" placeholder="0.00" required className={inputCls} /></Field>
      <Field label="Description"><input name="description" required placeholder="Registration fee, field trip…" className={inputCls} /></Field>
      <Field label="Revenue account">
        <select name="accountId" className={inputCls}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Invoice date"><input name="issueDate" type="date" defaultValue={formatDayISO(today())} className={inputCls} /></Field>
      <Field label="Due date" hint="Defaults to your payment terms"><input name="dueDate" type="date" className={inputCls} /></Field>
    </ActionForm>
  );
}

export function AdjustmentForm({ payers, returnPath }: { payers: Option[]; returnPath?: string }) {
  return (
    <ActionForm action={adjustmentAction} submitLabel="Post adjustment" buttonClassName={btnSecondary} className="grid gap-3 sm:grid-cols-2">
      {returnPath && <input type="hidden" name="returnPath" value={returnPath} />}
      <PayerSelect payers={payers} />
      <Field label="Amount"><input name="amount" inputMode="decimal" placeholder="0.00" required className={inputCls} /></Field>
      <Field label="Type">
        <select name="kind" className={inputCls}>
          <option value="CREDIT">Credit (reduces revenue)</option>
          <option value="WRITE_OFF">Write-off (bad debt)</option>
        </select>
      </Field>
      <Field label="Reason"><input name="reason" required placeholder="Closure day, goodwill…" className={inputCls} /></Field>
    </ActionForm>
  );
}
