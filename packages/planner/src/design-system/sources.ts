import type { LookAndFeelDecision } from "./types.js";
import { PRIMITIVE_STATES, UI_CONVENTIONS } from "./types.js";

const HEADER = `import * as React from "react";\n`;

function buttonSource(): string {
  return `${HEADER}
type ButtonState = "default" | "hover" | "focus" | "disabled" | "loading" | "error";

export function Button(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "secondary" | "danger";
    state?: ButtonState;
  },
): React.ReactElement {
  const { variant = "primary", state = "default", children, ...rest } = props;
  const disabled = state === "disabled" || rest.disabled === true;
  return (
    <button
      type="button"
      data-variant={variant}
      data-state={state}
      aria-busy={state === "loading" ? "true" : undefined}
      aria-invalid={state === "error" ? "true" : undefined}
      disabled={disabled}
      className={"ui-button ui-button-" + variant}
      {...rest}
    >
      {state === "loading" ? "Loading" : children}
    </button>
  );
}
`;
}

function inputSource(): string {
  return `${HEADER}
export function Input(
  props: React.InputHTMLAttributes<HTMLInputElement> & {
    label: string;
    state?: "default" | "hover" | "focus" | "disabled" | "loading" | "error";
  },
): React.ReactElement {
  const { label, state = "default", id, ...rest } = props;
  const fieldId = id ?? rest.name ?? "field";
  return (
    <div className="ui-field" data-state={state}>
      <label htmlFor={fieldId}>{label}</label>
      <input
        id={fieldId}
        className="ui-input"
        data-state={state}
        aria-invalid={state === "error" ? "true" : undefined}
        disabled={state === "disabled" || rest.disabled === true}
        {...rest}
      />
    </div>
  );
}
`;
}

function dialogSource(): string {
  return `${HEADER}
export function Dialog(
  props: {
    title: string;
    titleId?: string;
    state?: "default" | "hover" | "focus" | "disabled" | "loading" | "error";
    children?: React.ReactNode;
  },
): React.ReactElement {
  const titleId = props.titleId ?? "dialog-title";
  return (
    <dialog className="ui-dialog" data-state={props.state ?? "default"} aria-labelledby={titleId}>
      <h2 id={titleId}>{props.title}</h2>
      {props.children}
    </dialog>
  );
}
`;
}

function simpleSource(name: string, body: string): string {
  return `${HEADER}export function ${name}(props: { children?: React.ReactNode; title?: string }): React.ReactElement {\n  return (\n${body}\n  );\n}\n`;
}

export function uiSources(): { path: string; contents: string }[] {
  return [
    { path: "src/components/ui/button.tsx", contents: buttonSource() },
    { path: "src/components/ui/input.tsx", contents: inputSource() },
    { path: "src/components/ui/dialog.tsx", contents: dialogSource() },
    {
      path: "src/components/ui/card.tsx",
      contents: simpleSource("Card", `    <section className="ui-surface-raised" data-state="default">{props.children}</section>`),
    },
    {
      path: "src/components/ui/table.tsx",
      contents: `${HEADER}export function Table(props: { columns: readonly string[]; caption: string }): React.ReactElement {\n  return (\n    <table className="ui-table">\n      <caption>{props.caption}</caption>\n      <thead><tr>{props.columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>\n    </table>\n  );\n}\n`,
    },
    {
      path: "src/components/ui/toast.tsx",
      contents: simpleSource("Toast", `    <div role="status" className="ui-toast" data-state="default">{props.children}</div>`),
    },
    {
      path: "src/components/ui/empty-state.tsx",
      contents: simpleSource("EmptyState", `    <div role="status" className="ui-surface" data-template="empty-state">{props.children ?? "Nothing here yet"}</div>`),
    },
    {
      path: "src/components/ui/error-state.tsx",
      contents: simpleSource("ErrorState", `    <div role="alert" className="ui-surface" data-template="error-state">{props.children ?? "Something went wrong"}</div>`),
    },
    {
      path: "src/components/ui/form.tsx",
      contents: `${HEADER}export function Form(props: { children?: React.ReactNode; label?: string }): React.ReactElement {\n  return <form aria-label={props.label ?? "Form"} className="ui-form">{props.children}</form>;\n}\n`,
    },
    {
      path: "src/components/ui/nav.tsx",
      contents: `${HEADER}export function Nav(): React.ReactElement {\n  return (\n    <nav aria-label="Primary" className="ui-nav">\n      <a href="/">Home</a>\n    </nav>\n  );\n}\n`,
    },
    {
      path: "src/components/ui/text.tsx",
      contents: simpleSource("Text", `    <p className="ui-text">{props.children}</p>`),
    },
    {
      path: "src/components/ui/stack.tsx",
      contents: simpleSource("Stack", `    <div className="ui-stack">{props.children}</div>`),
    },
    {
      path: "src/components/ui/page-header.tsx",
      contents: `${HEADER}export function PageHeader(props: { title: string; actions?: React.ReactNode }): React.ReactElement {\n  return (\n    <header className="ui-page-header" data-template="page-header">\n      <h1>{props.title}</h1>\n      <div className="ui-page-header-actions">{props.actions}</div>\n    </header>\n  );\n}\n`,
    },
  ];
}

export function layoutSources(includePrint: boolean): { path: string; contents: string }[] {
  const files = [
    {
      path: "src/components/layouts/app-shell.tsx",
      contents: `${HEADER}import { Nav } from "../ui/nav.js";\n\nexport function AppShell(props: { children?: React.ReactNode }): React.ReactElement {\n  return (\n    <div className="layout-app-shell" data-template="app-shell">\n      <Nav />\n      <main className="layout-app-shell-content">{props.children}</main>\n    </div>\n  );\n}\n`,
    },
    {
      path: "src/components/layouts/list-page.tsx",
      contents: `${HEADER}import { EmptyState } from "../ui/empty-state.js";\nimport { PageHeader } from "../ui/page-header.js";\nimport { Table } from "../ui/table.js";\n\nexport function ListPage(props: { title: string; actions?: React.ReactNode }): React.ReactElement {\n  return (\n    <section data-template="list-detail">\n      <PageHeader title={props.title} actions={props.actions} />\n      <Table columns={["Name"]} caption={props.title} />\n      <EmptyState />\n    </section>\n  );\n}\n`,
    },
    {
      path: "src/components/layouts/detail-page.tsx",
      contents: `${HEADER}import { PageHeader } from "../ui/page-header.js";\n\nexport function DetailPage(props: { title: string; children?: React.ReactNode; actions?: React.ReactNode }): React.ReactElement {\n  return (\n    <article data-template="detail-page">\n      <PageHeader title={props.title} actions={props.actions} />\n      <div className="ui-surface">{props.children}</div>\n    </article>\n  );\n}\n`,
    },
    {
      path: "src/components/layouts/form-page.tsx",
      contents: `${HEADER}import { Button } from "../ui/button.js";\nimport { Form } from "../ui/form.js";\nimport { Input } from "../ui/input.js";\nimport { PageHeader } from "../ui/page-header.js";\n\nexport function FormPage(props: { title: string }): React.ReactElement {\n  return (\n    <section data-template="form-page">\n      <PageHeader title={props.title} actions={<Button variant="primary">Save</Button>} />\n      <Form label={props.title}>\n        <Input label="Name" name="name" />\n      </Form>\n    </section>\n  );\n}\n`,
    },
    {
      path: "src/components/layouts/auth-page.tsx",
      contents: `${HEADER}import { Button } from "../ui/button.js";\nimport { Card } from "../ui/card.js";\nimport { Form } from "../ui/form.js";\nimport { Input } from "../ui/input.js";\n\nexport function AuthPage(): React.ReactElement {\n  return (\n    <Card>\n      <Form label="Sign in">\n        <Input label="Email" name="email" />\n        <Button variant="primary">Continue</Button>\n      </Form>\n    </Card>\n  );\n}\n`,
    },
  ];
  if (includePrint) {
    files.push({
      path: "src/components/layouts/print-layout.tsx",
      contents: `${HEADER}export function PrintLayout(props: { title: string; children?: React.ReactNode }): React.ReactElement {\n  return (\n    <main className="layout-print" data-template="print-layout">\n      <h1>{props.title}</h1>\n      {props.children}\n    </main>\n  );\n}\n`,
    });
  }
  return files;
}

export function styleguideSource(
  decision: LookAndFeelDecision,
  pairing: readonly string[],
  includePrint: boolean,
): string {
  const themes = decision.theme === "both" ? ["light", "dark"] : [decision.theme];
  const stateBlocks = PRIMITIVE_STATES.map(
    (state) => `        <Button variant="primary" state="${state}">${state}</Button>`,
  ).join("\n");
  const themeBlocks = themes
    .map(
      (theme) => `      <section data-theme="${theme}" className="ui-surface">
        <h2>${theme}</h2>
${stateBlocks}
        <Input label="Email" name="email" state="default" />
        <Dialog title="Confirm" state="default"><p>Review the change</p></Dialog>
        <Toast>Saved</Toast>
        <Card><Text>Card</Text></Card>
        <Table columns={["Name"]} caption="Rows" />
        <EmptyState />
        <ErrorState />
        <Form label="Example"><Input label="Field" name="field" /></Form>
        <Nav />
        <Stack><Text>Stack</Text></Stack>
        <PageHeader title="Page title" actions={<Button variant="primary">Save</Button>} />
        <AppShell><p>Shell</p></AppShell>
        <ListPage title="List" />
        <DetailPage title="Detail"><p>Body</p></DetailPage>
        <FormPage title="Form" />
        <AuthPage />
        ${includePrint ? "<PrintLayout title=\"Print\"><p>Print</p></PrintLayout>" : ""}
      </section>`,
    )
    .join("\n");
  const lines = pairing.map((line) => `        <li>${line}</li>`).join("\n");
  const conventions = UI_CONVENTIONS.map((line) => `        <li>${line}</li>`).join("\n");
  return `${HEADER}import { AppShell } from "../components/layouts/app-shell.js";
import { AuthPage } from "../components/layouts/auth-page.js";
import { DetailPage } from "../components/layouts/detail-page.js";
import { FormPage } from "../components/layouts/form-page.js";
import { ListPage } from "../components/layouts/list-page.js";
${includePrint ? 'import { PrintLayout } from "../components/layouts/print-layout.js";\n' : ""}import { Button } from "../components/ui/button.js";
import { Card } from "../components/ui/card.js";
import { Dialog } from "../components/ui/dialog.js";
import { EmptyState } from "../components/ui/empty-state.js";
import { ErrorState } from "../components/ui/error-state.js";
import { Form } from "../components/ui/form.js";
import { Input } from "../components/ui/input.js";
import { Nav } from "../components/ui/nav.js";
import { PageHeader } from "../components/ui/page-header.js";
import { Stack } from "../components/ui/stack.js";
import { Table } from "../components/ui/table.js";
import { Text } from "../components/ui/text.js";
import { Toast } from "../components/ui/toast.js";

const styleguideEnabled = import.meta.env.DEV && process.env.NODE_ENV !== 'production';

export function StyleguideRoute(): React.ReactElement | null {
  if (!styleguideEnabled) return null;
  return (
    <main data-ef-styleguide="root" data-route="/__styleguide">
      <h1>Styleguide</h1>
      <p>Swatches, type, primitives, and templates use the token stylesheet.</p>
      <ul>
${lines}
      </ul>
      <ul>
${conventions}
      </ul>
${themeBlocks}
    </main>
  );
}
`;
}

export function adoptedStyleguideSource(
  decision: LookAndFeelDecision,
  pairing: readonly string[],
  kit: string,
): string {
  const themes = decision.theme === "both" ? ["light", "dark"] : [decision.theme];
  const states = PRIMITIVE_STATES.map((state) => `        <p data-state="${state}">${state}</p>`).join("\n");
  const sections = themes
    .map(
      (theme) => `      <section data-theme="${theme}" className="ui-surface">
        <h2>${theme}</h2>
${states}
      </section>`,
    )
    .join("\n");
  const lines = pairing.map((line) => `        <li>${line}</li>`).join("\n");
  return `${HEADER}const styleguideEnabled = import.meta.env.DEV && process.env.NODE_ENV !== 'production';

export function StyleguideRoute(): React.ReactElement | null {
  if (!styleguideEnabled) return null;
  return (
    <main data-ef-styleguide="root" data-route="/__styleguide">
      <h1>Styleguide</h1>
      <p>Existing ${kit} primitives stay locked. Token swatches use the adopted palette.</p>
      <ul>
${lines}
      </ul>
${sections}
    </main>
  );
}
`;
}
