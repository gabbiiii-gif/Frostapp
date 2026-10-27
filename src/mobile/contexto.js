// Contexto da casca mobile: dados, navegação e ações compartilhadas entre a
// casca (MobileApp.jsx), as telas e os formulários. Arquivo próprio para as
// telas não importarem o MobileApp (evita import circular).
import { createContext, useContext } from "react";

export const MobileCtx = createContext(null);
export const useMobile = () => useContext(MobileCtx);
