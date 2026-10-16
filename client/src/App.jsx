import { BrowserRouter, Routes, Route } from "react-router-dom";
import MenuPage from "./MenuPage.jsx";
import StaffPage from "./StaffPage.jsx";
import TrackPage from "./TrackPage.jsx";
import QrPage from "./QrPage.jsx";
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/m/:slug" element={<MenuPage />} />
        <Route path="/staff/:slug" element={<StaffPage />} />
        <Route path="/staff/:slug/qr" element={<QrPage />} />
        <Route path="/track/:token" element={<TrackPage />} />
        <Route path="*" element={<p className="notice">Scan the QR code on your table to view the menu.</p>} />
      </Routes>
    </BrowserRouter>
  );
}