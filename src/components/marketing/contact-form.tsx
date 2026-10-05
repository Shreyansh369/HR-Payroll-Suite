"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { SALES_EMAIL } from "@/config/env";

/**
 * Composes an email in the visitor's mail app. There is deliberately no hidden
 * backend that pretends to deliver messages.
 */
export function ContactForm() {
  const [f, setF] = useState({ name: "", company: "", employees: "1–10", topic: "Plans and pricing", message: "" });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const body = `Name: ${f.name}\nCompany: ${f.company}\nEmployees: ${f.employees}\n\n${f.message}`;
  const href = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(`${f.topic} — ${f.company || f.name}`)}&body=${encodeURIComponent(body)}`;
  return (
    <form
      className="space-y-4 rounded-xl border border-line bg-surface p-6"
      onSubmit={(e) => {
        e.preventDefault();
        window.location.href = href;
      }}
    >
      <FormGrid cols={2}>
        <Field label="Your name" required><Input autoComplete="name" value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Company"><Input autoComplete="organization" value={f.company} onChange={(e) => set("company", e.target.value)} /></Field>
        <Field label="Employees">
          <Select value={f.employees} onChange={(e) => set("employees", e.target.value)}>
            {["1–10", "11–25", "26–50", "51–100", "100+"].map((x) => <option key={x}>{x}</option>)}
          </Select>
        </Field>
        <Field label="Topic">
          <Select value={f.topic} onChange={(e) => set("topic", e.target.value)}>
            {["Plans and pricing", "Book a walkthrough", "Self-hosting", "Data migration", "Something else"].map((x) => <option key={x}>{x}</option>)}
          </Select>
        </Field>
      </FormGrid>
      <Field label="Message" required><Textarea rows={6} value={f.message} onChange={(e) => set("message", e.target.value)} /></Field>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-ink-3">Opens your email app with this message addressed to {SALES_EMAIL}.</p>
        <Button type="submit" variant="primary" disabled={!f.name.trim() || !f.message.trim()}>Compose email</Button>
      </div>
    </form>
  );
}
