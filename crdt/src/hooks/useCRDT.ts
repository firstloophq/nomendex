import { useContext } from "react";
import { CRDTContext, type CRDTContextValue } from "./CRDTProvider";

export function useCRDT(): CRDTContextValue {
  const ctx = useContext(CRDTContext);
  if (!ctx) {
    throw new Error("useCRDT must be used within a <CRDTProvider>");
  }
  return ctx;
}

export function useClientId(): string {
  return useCRDT().clientId;
}

export function useTransport(): Pick<
  CRDTContextValue,
  "sendOps" | "disconnect" | "reconnect" | "pendingOpsCount" | "isConnected"
> {
  const ctx = useCRDT();
  return {
    sendOps: ctx.sendOps,
    disconnect: ctx.disconnect,
    reconnect: ctx.reconnect,
    pendingOpsCount: ctx.pendingOpsCount,
    isConnected: ctx.isConnected,
  };
}
