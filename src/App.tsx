import { Navigate, Route, Routes } from "react-router-dom";

import { Login } from "./pages/Login";
import { SmsQR } from "./pages/SmsQR";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<SmsQR />} />
      <Route path="/auth/login" element={<Login />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
