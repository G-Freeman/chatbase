// router.tsx
import { createBrowserRouter, Outlet, redirect } from "react-router-dom";
import Main from "@/pages/Main";
import UIKitPage from "@/pages/UIKit";
import NotFoundPage from "@/pages/NotFound";

function Layout() {
    return (
        <div className="min-h-screen bg-slate-900 text-slate-100">
            <Outlet />
        </div>
    );
}

async function authLoader() {
    const ok = Boolean(localStorage.getItem("token"));
    if (!ok) {
        throw redirect("/login");
    }
    return null;
}

export const router = createBrowserRouter([
    {
        element: <Layout />,
        children: [
            { index: true, element: <Main /> },
            { path: "/ui", element: <UIKitPage />, loader: authLoader },
            { path: "*", element: <NotFoundPage /> },
        ],
    },
]);
