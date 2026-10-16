import { useCallback, useEffect, useRef, useState } from "react";
import client from "../api/client";

/**
 * const { data, error, loading, reload, setData } = useApi("/student/dashboard", { params })
 * Pass url = null to skip the request. Stale responses (from an older url/params) are ignored.
 */
export default function useApi(url, { params } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(Boolean(url));
  const requestId = useRef(0);
  const paramsKey = JSON.stringify(params || {});

  const load = useCallback(
    async ({ quiet = false } = {}) => {
      if (!url) return;
      const id = ++requestId.current;
      if (!quiet) setLoading(true);
      setError(null);
      try {
        const res = await client.get(url, { params: JSON.parse(paramsKey) });
        if (id === requestId.current) setData(res.data);
      } catch (e) {
        if (id === requestId.current) setError(e.response?.data?.error || e.message || "Something went wrong");
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [url, paramsKey]
  );

  useEffect(() => {
    load();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}
