import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";

const UIKit   = lazy(() => import("@/pages/UIKit"));
const Home    = lazy(() => import("@/pages/Main"));
const NotFound= lazy(() => import("@/pages/NotFound"));

export default function App() {
    return (
        <Suspense fallback={<div className="p-6">Loading…</div>}>
            <Routes>
                <Route >
                    <Route index element={<Home />} />
                    <Route path="*" element={<NotFound />} />
                    <Route path="/ui" element={<UIKit />} />
                </Route>
            </Routes>
        </Suspense>
    );
}