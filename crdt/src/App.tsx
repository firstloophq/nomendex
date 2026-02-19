import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CollaborativeDemo } from "@/components/CollaborativeDemo";
import { KanbanBoard } from "@/components/KanbanBoard";
import { TldrawRoom } from "@/components/TldrawRoom";
import { CRDTProvider } from "@/hooks/CRDTProvider";
import "./index.css";

type Route = "kanban" | "collab" | "tldraw";

function parseRoute(): Route {
  const hash = window.location.hash.replace("#", "");
  if (hash === "collab") return "collab";
  if (hash === "tldraw") return "tldraw";
  return "kanban";
}

export function App() {
  const [route, setRoute] = useState<Route>(parseRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = (r: Route) => {
    window.location.hash = r;
  };

  return (
    <CRDTProvider>
      <div className="container mx-auto p-8 relative z-10">
        {/* Navigation */}
        <nav className="flex gap-2 mb-6">
          <Button
            variant={route === "kanban" ? "default" : "outline"}
            size="sm"
            onClick={() => navigate("kanban")}
          >
            Kanban Board
          </Button>
          <Button
            variant={route === "collab" ? "default" : "outline"}
            size="sm"
            onClick={() => navigate("collab")}
          >
            Collaborative Editor
          </Button>
          <Button
            variant={route === "tldraw" ? "default" : "outline"}
            size="sm"
            onClick={() => navigate("tldraw")}
          >
            Canvas
          </Button>
        </nav>

        {route === "kanban" && <KanbanBoard />}

        {route === "collab" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl font-bold">CRDT Collaborative Editor</CardTitle>
              <CardDescription>
                Two independent ProseMirror editors syncing via CRDT over WebSocket.
                Type in either editor and watch changes appear in the other.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CollaborativeDemo />
            </CardContent>
          </Card>
        )}

        {route === "tldraw" && <TldrawRoom />}
      </div>
    </CRDTProvider>
  );
}

export default App;
