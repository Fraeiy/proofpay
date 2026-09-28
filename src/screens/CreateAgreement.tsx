import { useEffect, useId, useRef, useState } from "react";
import { useBlocker, useNavigate, useParams } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { Button, Dialog, PageIntro, TextArea, TextField, usePageTitle } from "../components/ui";
import { createId, formatMoney, parseAmountToCents, todayISO, TOKEN } from "../domain/format";
import { PAYMENT_RULES } from "../domain/terms";
import type { AgreementInput, FieldErrors, MilestoneInput } from "../domain/types";
import { emptyAgreement, emptyMilestone, firstErrorKey, hasErrors, validateAgreementInput } from "../domain/validate";
import { AMARA } from "../demo/people";
import { useDemo } from "../demo/store";
import { weeklySocialTemplate } from "../demo/template";
import { shortWallet } from "../domain/format";

type Step = 1 | 2 | 3;

function errorsForStep(errors: FieldErrors, step: Step): FieldErrors {
  return Object.fromEntries(
    Object.entries(errors).filter(([key]) => {
      if (step === 1) return ["title", "clientName", "clientWallet", "description"].includes(key);
      if (step === 2) return key === "milestones" || key.startsWith("milestone.");
      return true;
    }),
  );
}

function stepForKey(key: string): Step {
  return key.startsWith("milestone") || key === "milestones" ? 2 : 1;
}

export function CreateAgreement() {
  const { agreementId } = useParams();
  const demo = useDemo();
  const navigate = useNavigate();
  const existing = demo.state.agreements.find((agreement) => agreement.id === agreementId);
  const editing = Boolean(agreementId);
  usePageTitle(editing ? "Edit draft" : "New agreement");
  const [form, setForm] = useState<AgreementInput>(() => existing?.draft ?? emptyAgreement(createId("ms")));
  const [step, setStep] = useState<Step>(1);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [confirmTemplate, setConfirmTemplate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const baseline = useRef(JSON.stringify(existing?.draft ?? form));
  const allowLeave = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dirty = JSON.stringify(form) !== baseline.current;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => !allowLeave.current && dirty && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (!existing) return;
    if (existing.status !== "draft") navigate(`/agreements/${existing.id}`, { replace: true });
  }, [existing, navigate]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (!dirty) return;
    const onLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  if (agreementId && !existing) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p className="font-bold">{demo.mode === "live" ? "This draft is not on your account." : "This draft is not in the sample."}</p>
        <Button className="mt-4" onClick={() => navigate("/agreements")}>Back to agreements</Button>
      </div>
    );
  }

  function update<K extends keyof AgreementInput>(key: K, value: AgreementInput[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateMilestone(index: number, patch: Partial<MilestoneInput>) {
    setForm((current) => ({
      ...current,
      milestones: current.milestones.map((milestone, milestoneIndex) => (milestoneIndex === index ? { ...milestone, ...patch } : milestone)),
    }));
  }

  function goNext() {
    const found = errorsForStep(validateAgreementInput(form, demo.sessionWallet ?? AMARA.wallet, todayISO()), step);
    setErrors(found);
    if (hasErrors(found)) {
      const key = firstErrorKey(found);
      if (key) document.getElementById(key)?.focus();
      return;
    }
    setStep((current) => (current < 3 ? ((current + 1) as Step) : current));
  }

  async function save(mode: "draft" | "share") {
    if (mode === "share") {
      const found = validateAgreementInput(form, demo.sessionWallet ?? AMARA.wallet, todayISO());
      if (hasErrors(found)) {
        setErrors(found);
        const key = firstErrorKey(found);
        if (key) {
          setStep(stepForKey(key));
          window.setTimeout(() => document.getElementById(key)?.focus(), 0);
        }
        return;
      }
    }
    const result = await demo.saveAgreement(existing?.id ?? null, form, mode);
    if (!result.ok) {
      if (result.errors) {
        setErrors(result.errors);
        const key = firstErrorKey(result.errors);
        if (key) setStep(stepForKey(key));
      }
      return;
    }
    baseline.current = JSON.stringify(form);
    allowLeave.current = true;
    navigate(mode === "share" ? `/agreements/${result.id}` : `/agreements/${result.id}/edit`);
  }

  const total = form.milestones.reduce((sum, milestone) => sum + (parseAmountToCents(milestone.amount) ?? 0), 0);
  const stepTitle = step === 1 ? "People and work" : step === 2 ? "Milestones" : "Review and share";

  return (
    <div>
      <div className="mx-auto min-w-0 max-w-3xl px-4 py-6 lg:px-6">
        <PageIntro title={editing ? "Edit draft" : "New agreement"} lede={demo.mode === "live" ? "You are the freelancer on this agreement. The client sees it after your wallet commits these terms." : "You are Amara Cole, the freelancer. The client sees this only after you share it."} />
        <ol className="mb-6 grid grid-cols-3 gap-2" aria-label="Progress">
          {([1, 2, 3] as Step[]).map((number) => (
            <li key={number}>
              <button
                type="button"
                className={`min-h-11 w-full rounded-xl border px-2 text-left text-sm font-bold ${step === number ? "border-ink bg-ink text-canvas" : number < step ? "border-ink bg-lime text-anchor" : "border-line bg-paper text-muted"}`}
                onClick={() => { if (number < step) setStep(number); }}
                aria-current={step === number ? "step" : undefined}
              >
                {number}. {number === 1 ? "People" : number === 2 ? "Milestones" : "Review"}
              </button>
            </li>
          ))}
        </ol>
        <h2 ref={headingRef} tabIndex={-1} className="text-xl font-extrabold tracking-tight outline-none">{stepTitle}</h2>
        {step === 1 ? (
          <div className="mt-4 grid gap-4">
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => (dirty ? setConfirmTemplate(true) : setForm(weeklySocialTemplate(todayISO())))}>Use weekly social template</Button>
            </div>
            <TextField id="title" label="Agreement title" value={form.title} error={errors.title} onChange={(event) => update("title", event.target.value)} />
            <TextField id="clientName" label="Client name" value={form.clientName} error={errors.clientName} onChange={(event) => update("clientName", event.target.value)} />
            <TextField id="clientWallet" label="Client wallet address" value={form.clientWallet} error={errors.clientWallet} spellCheck={false} autoComplete="off" hint={demo.mode === "live" ? "0x and 40 hex characters. This must be a different wallet from yours." : "0x and 40 hex characters. This sample does not check that the address exists."} onChange={(event) => update("clientWallet", event.target.value)} />
            <p className="text-sm text-muted">Freelancer: {demo.profile?.displayName ?? AMARA.name} · {shortWallet(demo.sessionWallet ?? AMARA.wallet)}</p>
            <TextArea id="description" label="Work description" value={form.description} error={errors.description} onChange={(event) => update("description", event.target.value)} />
          </div>
        ) : null}
        {step === 2 ? (
          <div className="mt-4 grid gap-4">
            {errors.milestones ? <p className="error-text" role="alert">{errors.milestones}</p> : null}
            {form.milestones.map((milestone, index) => (
              <MilestoneEditor
                key={milestone.id}
                index={index}
                milestone={milestone}
                errors={errors}
                canRemove={form.milestones.length > 1}
                onChange={(patch) => updateMilestone(index, patch)}
                onRemove={() => update("milestones", form.milestones.filter((_, milestoneIndex) => milestoneIndex !== index))}
              />
            ))}
            <Button
              variant="ghost"
              unavailable={form.milestones.length >= 8}
              onClick={() => update("milestones", [...form.milestones, emptyMilestone(createId("ms"))])}
            >
              <Plus size={16} aria-hidden /> Add milestone
            </Button>
          </div>
        ) : null}
        {step === 3 ? (
          <div className="mt-4 grid gap-4">
            <section className="panel p-4">
              <h3 className="font-extrabold">{form.title || "Untitled agreement"}</h3>
              <p className="mt-1 text-sm text-muted">{form.clientName || "Client"} · {form.clientWallet || "No wallet yet"}</p>
              <p className="mt-3 whitespace-pre-wrap text-sm">{form.description}</p>
            </section>
            <ol className="grid gap-3">
              {form.milestones.map((milestone, index) => (
                <li key={milestone.id} className="panel p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-extrabold">{index + 1}. {milestone.title || "Untitled milestone"}</p>
                    <p className="font-extrabold tabular-nums">{formatMoney(parseAmountToCents(milestone.amount) ?? 0)} {TOKEN}</p>
                  </div>
                  <p className="text-sm text-muted">Due {milestone.dueDate || "not set"}</p>
                  <ul className="mt-2 list-disc pl-5 text-sm">
                    {milestone.deliverables.filter((line) => line.trim()).map((line) => <li key={line}>{line}</li>)}
                  </ul>
                </li>
              ))}
            </ol>
            <section className="panel-ink p-5">
              <p className="text-sm font-extrabold text-lime">Total to be funded, milestone by milestone</p>
              <p className="mt-2 text-4xl font-extrabold tabular-nums">{formatMoney(total)}</p>
              <p className="mt-1 font-bold">{TOKEN}</p>
              <p className="mt-3 text-sm text-on-anchor/75">Sharing does not fund anything. Each amount stays unsecured until the client accepts these terms and funds that milestone.</p>
            </section>
            <section className="panel p-4">
              <h3 className="font-extrabold">Payment rules</h3>
              <ul className="mt-2 grid gap-2 text-sm">
                {PAYMENT_RULES.map((rule) => <li key={rule}>{rule}</li>)}
              </ul>
            </section>
          </div>
        ) : null}
      </div>
      <div className="mt-6 border-t border-line bg-canvas">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-6">
          <Button variant="ghost" onClick={() => (step === 1 ? navigate("/agreements") : setStep((current) => (current - 1) as Step))}>Back</Button>
          <div className="flex flex-wrap justify-end gap-2">
            {existing ? <Button variant="danger" onClick={() => setConfirmDelete(true)}>Delete draft</Button> : null}
            <Button variant="quiet" onClick={() => save("draft")}>Save draft</Button>
            {step < 3 ? <Button onClick={goNext}>Continue</Button> : <Button onClick={() => save("share")}>Share with client</Button>}
          </div>
        </div>
      </div>
      <Dialog
        open={blocker.state === "blocked"}
        title="Leave this draft?"
        description="Unsaved changes stay only if you save the draft first."
        onClose={() => blocker.reset?.()}
        footer={
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="danger" onClick={() => blocker.proceed?.()}>Leave without saving</Button>
            <Button variant="ghost" onClick={() => blocker.reset?.()}>Stay</Button>
          </div>
        }
      >
        <p className="text-sm">You can save the draft and come back to it from Agreements. The client will not see it.</p>
      </Dialog>
      <Dialog
        open={confirmTemplate}
        title="Replace this draft with the weekly template?"
        onClose={() => setConfirmTemplate(false)}
        footer={
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button onClick={() => { setForm(weeklySocialTemplate(todayISO())); setConfirmTemplate(false); }}>Use template</Button>
            <Button variant="ghost" onClick={() => setConfirmTemplate(false)}>Keep what I typed</Button>
          </div>
        }
      >
        <p className="text-sm">The template fills four editable weeks. You still add the client before sharing.</p>
      </Dialog>
      <Dialog
        open={confirmDelete}
        title="Delete this draft?"
        onClose={() => setConfirmDelete(false)}
        footer={
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="danger" onClick={() => { if (!existing) return; allowLeave.current = true; void demo.deleteDraft(existing.id).then(() => navigate("/agreements")); }}>Delete draft</Button>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Keep draft</Button>
          </div>
        }
      >
        <p className="text-sm">The client never saw this draft. Deleting it only removes it from this browser.</p>
      </Dialog>
    </div>
  );
}

function MilestoneEditor({
  index,
  milestone,
  errors,
  canRemove,
  onChange,
  onRemove,
}: {
  index: number;
  milestone: MilestoneInput;
  errors: FieldErrors;
  canRemove: boolean;
  onChange: (patch: Partial<MilestoneInput>) => void;
  onRemove: () => void;
}) {
  const prefix = `milestone.${index}`;
  const listId = useId();
  return (
    <fieldset className="panel grid gap-3 p-4">
      <legend className="px-1 font-extrabold">Milestone {index + 1}</legend>
      <TextField id={`${prefix}.title`} label="Milestone title" value={milestone.title} error={errors[`${prefix}.title`]} onChange={(event) => onChange({ title: event.target.value })} />
      <div className="grid gap-2">
        <span className="text-sm font-bold" id={listId}>Deliverables</span>
        {milestone.deliverables.map((line, lineIndex) => (
          <div key={`${milestone.id}-d-${lineIndex}`} className="flex gap-2">
            <input
              id={lineIndex === 0 ? `${prefix}.deliverables` : undefined}
              aria-labelledby={listId}
              className="control"
              value={line}
              onChange={(event) => onChange({ deliverables: milestone.deliverables.map((item, itemIndex) => (itemIndex === lineIndex ? event.target.value : item)) })}
            />
            {milestone.deliverables.length > 1 ? (
              <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line" aria-label={`Remove deliverable ${lineIndex + 1}`} onClick={() => onChange({ deliverables: milestone.deliverables.filter((_, itemIndex) => itemIndex !== lineIndex) })}>
                <Trash2 size={16} />
              </button>
            ) : null}
          </div>
        ))}
        {errors[`${prefix}.deliverables`] ? <p className="error-text" role="alert">{errors[`${prefix}.deliverables`]}</p> : null}
        <Button variant="quiet" unavailable={milestone.deliverables.length >= 8} onClick={() => onChange({ deliverables: [...milestone.deliverables, ""] })}>Add deliverable</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id={`${prefix}.amount`} label="Amount" inputMode="decimal" value={milestone.amount} error={errors[`${prefix}.amount`]} hint={TOKEN} onChange={(event) => onChange({ amount: event.target.value })} />
        <TextField id={`${prefix}.dueDate`} label="Due date" type="date" value={milestone.dueDate} error={errors[`${prefix}.dueDate`]} onChange={(event) => onChange({ dueDate: event.target.value })} />
      </div>
      {canRemove ? <Button variant="danger" onClick={onRemove}>Remove milestone</Button> : null}
    </fieldset>
  );
}
