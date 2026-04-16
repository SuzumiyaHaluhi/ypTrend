import React, { useState } from "react";
import { cn } from "@/lib/utils";

export const CardSpotlight = ({
  children,
  radius = 320,
  color = "rgba(45, 212, 191, 0.18)",
  className,
  ...props
}) => {
  const [coords, setCoords] = useState({ x: 0, y: 0 });

  function handleMouseMove({ currentTarget, clientX, clientY }) {
    const { left, top } = currentTarget.getBoundingClientRect();
    setCoords({ x: clientX - left, y: clientY - top });
  }

  return (
    <div
      className={cn(
        "group/spotlight relative rounded-md border border-neutral-800 bg-black p-10 dark:border-neutral-800",
        className
      )}
      onMouseMove={handleMouseMove}
      {...props}
    >
      <div
        className="pointer-events-none absolute -inset-px z-0 rounded-md opacity-0 transition duration-300 group-hover/spotlight:opacity-100"
        style={{
          background: `radial-gradient(${radius}px circle at ${coords.x}px ${coords.y}px, ${color}, transparent 70%)`
        }}
      />
      {children}
    </div>
  );
};
