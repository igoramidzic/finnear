import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import { Home } from "./pages/Home";
import { Login } from "./pages/Login";

function UnauthenticatedShell() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (location.pathname !== "/auth/login") {
      navigate("/auth/login", { replace: true });
    }
  }, [location.pathname, navigate]);

  return <Login />;
}

export default function App() {
  return (
    <>
      <AuthLoading>
        <div className="min-h-screen flex items-center justify-center text-muted-foreground">
          Loading...
        </div>
      </AuthLoading>
      <Unauthenticated>
        <UnauthenticatedShell />
      </Unauthenticated>
      <Authenticated>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Authenticated>
    </>
  );
}
