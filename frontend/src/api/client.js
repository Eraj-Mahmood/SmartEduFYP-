import axios from "axios";

const client = axios.create({ baseURL: "/api" });

client.interceptors.request.use((config) => {
  const token = localStorage.getItem("smartedu_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

client.interceptors.response.use(
  (res) => res,
  (err) => {
    // a failed login is a 401 too; only a rejected session token sends you back to the login page
    if (err.response?.status === 401 && !err.config?.url?.endsWith("/auth/login")) {
      localStorage.removeItem("smartedu_token");
      localStorage.removeItem("smartedu_role");
      if (["ACCOUNT_DISABLED", "TOKEN_REVOKED"].includes(err.response.data?.code)) {
        try {
          sessionStorage.setItem("smartedu_login_notice", err.response.data.error);
        } catch {
          /* storage unavailable: the login page just shows no notice */
        }
      }
      window.location.href = "/login";
    }
    // a temporary password must be changed first: go to the Change Password screen
    if (err.response?.status === 403 && err.response.data?.code === "PASSWORD_RESET_REQUIRED") {
      localStorage.setItem("smartedu_must_reset", "1");
      window.dispatchEvent(new Event("smartedu:must-reset"));
      if (window.location.pathname !== "/change-password") window.location.href = "/change-password";
    }
    return Promise.reject(err);
  }
);

export default client;
