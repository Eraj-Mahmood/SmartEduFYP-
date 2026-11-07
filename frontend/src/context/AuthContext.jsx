import { createContext, useContext, useEffect, useState } from "react";
import client from "../api/client";

const AuthContext = createContext(null);

// localStorage keys. smartedu_must_reset is set while the server requires a password change
// (login said mustResetPassword, or any request got 403 PASSWORD_RESET_REQUIRED).
const KEYS = ["smartedu_token", "smartedu_role", "smartedu_must_reset"];

export function AuthProvider({ children }) {
  const [role, setRole] = useState(localStorage.getItem("smartedu_role"));
  const [profile, setProfile] = useState(null);
  const [mustReset, setMustReset] = useState(localStorage.getItem("smartedu_must_reset") === "1");

  // the API client flags a forced reset it discovers on any request
  useEffect(() => {
    const onFlag = () => setMustReset(true);
    window.addEventListener("smartedu:must-reset", onFlag);
    return () => window.removeEventListener("smartedu:must-reset", onFlag);
  }, []);

  // Single login call for all 3 roles. The `role` the server returns is
  // what decides which portal the app routes into next.
  async function login(email, password) {
    const { data } = await client.post("/auth/login", { email, password });
    localStorage.setItem("smartedu_token", data.token);
    localStorage.setItem("smartedu_role", data.role);
    if (data.mustResetPassword) localStorage.setItem("smartedu_must_reset", "1");
    else localStorage.removeItem("smartedu_must_reset");
    setRole(data.role);
    setProfile(data.profile);
    setMustReset(Boolean(data.mustResetPassword));
    return data;
  }

  /** After a successful change-password: keep the fresh token and lift the block. */
  function completePasswordChange(token) {
    localStorage.setItem("smartedu_token", token);
    localStorage.removeItem("smartedu_must_reset");
    setMustReset(false);
  }

  function logout() {
    const token = localStorage.getItem("smartedu_token");
    // stateless on the server; best effort (the header is set here because the token is removed next)
    if (token) client.post("/auth/logout", null, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    KEYS.forEach((k) => localStorage.removeItem(k));
    setRole(null);
    setProfile(null);
    setMustReset(false);
  }

  return (
    <AuthContext.Provider value={{ role, profile, mustReset, login, logout, completePasswordChange }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
