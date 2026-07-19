import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./styles/covenant.css";
import Marketing from "./Marketing.tsx";
import ProductApp from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Marketing />} />
        <Route path="/app" element={<ProductApp />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
