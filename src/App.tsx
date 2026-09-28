import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { EmptyState } from "./components/EmptyState";
import { ButtonLink, usePageTitle } from "./components/ui";
import { DemoProvider } from "./demo/store";
import { LiveProvider } from "./live/store";
import { readMode } from "./mode";
import { AgreementDetail } from "./screens/AgreementDetail";
import { Agreements } from "./screens/Agreements";
import { CreateAgreement } from "./screens/CreateAgreement";
import { Overview } from "./screens/Overview";
import { Payments } from "./screens/Payments";
import { ReceiptPage } from "./screens/ReceiptPage";
import { Welcome } from "./screens/Welcome";

function NotFound() {
  usePageTitle("Not found");
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <EmptyState title="That page is not here" body="Overview, agreements, and payments are still available." action={<ButtonLink to="/overview" variant="ink">Back to overview</ButtonLink>} />
    </div>
  );
}

const router = createBrowserRouter([
  { path: "/", element: <Welcome /> },
  {
    element: <AppShell />,
    children: [
      { path: "/overview", element: <Overview /> },
      { path: "/agreements", element: <Agreements /> },
      { path: "/agreements/new", element: <CreateAgreement /> },
      { path: "/agreements/:agreementId/edit", element: <CreateAgreement /> },
      { path: "/agreements/:agreementId", element: <AgreementDetail /> },
      { path: "/payments", element: <Payments /> },
      { path: "/payments/:entryId", element: <ReceiptPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

export function App() {
  const preview = readMode() === "preview";
  const shell = <RouterProvider router={router} />;
  return preview ? <DemoProvider>{shell}</DemoProvider> : <LiveProvider>{shell}</LiveProvider>;
}
