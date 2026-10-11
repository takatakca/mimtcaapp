// Providers and routes. URLs are French first (app.mimt.ca/messages, /appels, /messagerie, /compte,
// /services/…, /affaires/:id/…). The static host serves index.html for every path (SPA fallback).
import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { SessionProvider, useSession } from "./auth/SessionProvider";
import { CALLBACK_PATH } from "./auth/takatak";
import { Shell } from "./components/Shell";
import { Loading } from "./components/ui";
import { I18nProvider } from "./i18n/I18nProvider";
import type { Lang } from "./i18n/core";
import { Account } from "./pages/Account";
import { AuthCallback } from "./pages/AuthCallback";
import { CallSettings } from "./pages/CallSettings";
import { Calls } from "./pages/Calls";
import { Messages } from "./pages/Messages";
import { NotFound } from "./pages/NotFound";
import { OtpSignIn } from "./pages/OtpSignIn";
import { PortIn } from "./pages/PortIn";
import { SignIn } from "./pages/SignIn";
import { Voicemail } from "./pages/Voicemail";
import { BusinessLayout } from "./pages/business/BusinessLayout";
import { Extensions } from "./pages/business/Extensions";
import { Hours } from "./pages/business/Hours";
import { IvrMenus } from "./pages/business/IvrMenus";
import { Members } from "./pages/business/Members";
import { Numbers } from "./pages/business/Numbers";
import { BusinessOverview } from "./pages/business/Overview";
import { RingGroups } from "./pages/business/RingGroups";
import { AiReceptionist } from "./pages/business/AiReceptionist";
import { Recordings } from "./pages/business/Recordings";
import { Offers } from "./pages/services/Offers";
import { OrderDetail } from "./pages/services/OrderDetail";
import { Orders } from "./pages/services/Orders";
import { PhoneProvider } from "./phone/PhoneProvider";

/** Signed-in area: waits for the session restore, then sends signed-out visitors to /connexion. */
function RequireSession({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const location = useLocation();
  if (status === "loading") return <Loading />;
  if (status === "signedOut") return <Navigate to="/connexion" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

/** Sign-in pages: a signed-in visitor goes straight to the app. */
function SignedOutOnly({ children }: { children: ReactNode }) {
  const { status } = useSession();
  if (status === "loading") return <Loading />;
  if (status === "signedIn") return <Navigate to="/messages" replace />;
  return <>{children}</>;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/connexion"
        element={
          <SignedOutOnly>
            <SignIn />
          </SignedOutOnly>
        }
      />
      <Route
        path="/connexion/texto"
        element={
          <SignedOutOnly>
            <OtpSignIn />
          </SignedOutOnly>
        }
      />
      <Route path={CALLBACK_PATH} element={<AuthCallback />} />
      <Route
        element={
          <RequireSession>
            <Shell />
          </RequireSession>
        }
      >
        <Route index element={<Navigate to="/messages" replace />} />
        <Route path="messages" element={<Messages />} />
        <Route path="messages/:peer" element={<Messages />} />
        <Route path="appels" element={<Calls />} />
        <Route path="messagerie" element={<Voicemail />} />
        <Route path="compte" element={<Account />} />
        <Route path="compte/appels" element={<CallSettings />} />
        <Route path="services" element={<Navigate to="/services/offres" replace />} />
        <Route path="services/offres" element={<Offers />} />
        <Route path="services/commandes" element={<Orders />} />
        <Route path="services/commandes/:orderId" element={<OrderDetail />} />
        <Route path="services/transfert" element={<PortIn />} />
        <Route path="affaires/:businessId" element={<BusinessLayout />}>
          <Route index element={<BusinessOverview />} />
          <Route path="postes" element={<Extensions />} />
          <Route path="groupes" element={<RingGroups />} />
          <Route path="accueil" element={<IvrMenus />} />
          <Route path="heures" element={<Hours />} />
          <Route path="numeros" element={<Numbers />} />
          <Route path="membres" element={<Members />} />
          <Route path="enregistrements" element={<Recordings />} />
          <Route path="receptionniste-ia" element={<AiReceptionist />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export function App({ lang }: { lang?: Lang }) {
  return (
    <I18nProvider initial={lang}>
      <SessionProvider>
        <PhoneProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </PhoneProvider>
      </SessionProvider>
    </I18nProvider>
  );
}
