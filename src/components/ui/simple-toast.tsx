"use client";

import { useEffect, useState } from "react";
import { CheckCircle, XCircle } from "lucide-react";

interface ToastProps {
  message: string | null;
  type?: "success" | "error";
  onClose: () => void;
}

export const SimpleToast = ({ message, type = "success", onClose }: ToastProps) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (message) {
      setVisible(true);
      const timer = setTimeout(() => {
        setVisible(false);
        setTimeout(onClose, 300); // Wait for fade out animation
      }, 3000); // Hilang setelah 3 detik
      return () => clearTimeout(timer);
    }
  }, [message, onClose]);

  if (!message && !visible) return null;

  return (
    <div 
      className={`fixed top-4 left-1/2 transform -translate-x-1/2 z-[100] flex items-center gap-2 px-4 py-3 rounded-full shadow-2xl transition-all duration-300 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4"
      } ${
        type === "success" ? "bg-black text-white dark:bg-white dark:text-black" : "bg-red-500 text-white"
      }`}
    >
      {type === "success" ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
      <span className="text-sm font-bold">{message}</span>
    </div>
  );
};