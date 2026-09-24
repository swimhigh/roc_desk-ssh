import { useEffect } from "react";
import { HomeShell } from "./components/RemoteTool/HomeShell";
import { ToastStack } from "./components/shared/Toast";
import { HostKeyPromptHost } from "./components/ConnectionManager/HostKeyPromptHost";
import { AgentCertPromptHost } from "./components/ConnectionManager/AgentCertPromptHost";
import { registerAgentCertPromptListener, registerHostKeyPromptListener } from "./stores/connectionStore";
import "./stores/themeStore"; // side-effect import: 应用启动时立即读取/应用存储的主题

/**
 * 应用根组件——原样搬自宿主 `HomeShell.tsx`（`--mode=ssh` 模块窗口的完整挂载对象）
 * + 一直挂在顶层的 Toast/TOFU 弹窗宿主，是这次 restoration pass（见
 * `docs/MULTI_REPO_SPLIT_PROGRESS.md` 2026-09-23）替换掉的简化版 App.tsx。
 */
export default function App() {
  useEffect(() => {
    const unlistenHostKey = registerHostKeyPromptListener();
    const unlistenAgentCert = registerAgentCertPromptListener();
    return () => {
      unlistenHostKey.then((f) => f());
      unlistenAgentCert.then((f) => f());
    };
  }, []);

  return (
    <>
      <HomeShell />
      <ToastStack />
      <HostKeyPromptHost />
      <AgentCertPromptHost />
    </>
  );
}
