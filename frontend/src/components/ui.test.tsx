import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState, Badge } from "./ui";

describe("UI primitives", () => {
  it("renders an empty state with title and testid", () => {
    render(<EmptyState title="No projects registered" hint="Register one" />);
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.getByText("No projects registered")).toBeInTheDocument();
  });

  it("renders a badge", () => {
    render(<Badge tone="verified">delete</Badge>);
    expect(screen.getByText("delete")).toBeInTheDocument();
  });
});
