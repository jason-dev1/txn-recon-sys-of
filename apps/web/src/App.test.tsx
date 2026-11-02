import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App.js";

describe("App", () => {
  it("shows the setup page and API health link", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Project setup is ready" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Check API health" })).toHaveAttribute(
      "href",
      "http://localhost:3000/health",
    );
  });
});
