"use client";

import { useContext } from "react";
import { AuthContext, type AuthContextValue } from "@/context/AuthContext";

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

