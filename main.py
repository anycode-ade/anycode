def greet(name: str) -> str:
    """Return a greeting message."""
    return f"Hello, {name}! Welcome to Anycode."

def calculate_stats(numbers: list[int | float]) -> dict[str, float]:
    """Calculate basic statistics for a list of numbers."""
    if not numbers:
        return {"count": 0, "sum": 0.0, "mean": 0.0}

    total = sum(numbers)
    mean = total / len(numbers)
    return {
        "count": len(numbers),
        "sum": float(total),
        "mean": mean,
    }

print(41241)

if __name__ == "__main__":
    print(greet("Developer"))
    data = [10, 20, 30, 40, 50]
    stats = calculate_stats(data)
    print(f"Data stats: {stats}")
