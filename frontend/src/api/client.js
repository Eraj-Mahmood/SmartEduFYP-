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
      if (err.response.data?.code === "ACCOUNT_DISABLED") {
        try {
          sessionStorage.setItem("smartedu_login_notice", err.response.data.error);
        } catch {
          /* storage unavailable: the login page just shows no notice */
        }
      }
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export default client;
