import { createContext, useContext, useState } from "react";
import client from "../api/client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [role, setRole] = useState(localStorage.getItem("smartedu_role"));
  const [profile, setProfile] = useState(null);

  // Single login call for all 3 roles. The `role` the server returns is
  // what decides which portal the app routes into next.
  async function login(email, password) {
    const { data } = await client.post("/auth/login", { email, password });
    localStorage.setItem("smartedu_token", data.token);
    localStorage.setItem("smartedu_role", data.role);
    setRole(data.role);
    setProfile(data.profile);
    return data;
  }

  function logout() {
    localStorage.removeItem("smartedu_token");
    localStorage.removeItem("smartedu_role");
    setRole(null);
    setProfile(null);
  }

  return (
    <AuthContext.Provider value={{ role, profile, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
