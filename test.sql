-- SQL syntax highlighting test

CREATE TABLE users (
  id BIGINT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  display_name TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE orders (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  total DECIMAL(10, 2) NOT NULL,
  status VARCHAR(32) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO users (id, email, display_name)
VALUES
  (1, 'alice@example.com', 'Alice'),
  (2, 'bob@example.com', 'Bob');

WITH active_users AS (
  SELECT id, email, display_name
  FROM users
  WHERE active = true
)
SELECT
  u.email,
  u.display_name,
  COUNT(o.id) AS order_count,
  COALESCE(SUM(o.total), 0) AS total_spent
FROM active_users AS u
LEFT JOIN orders AS o ON o.user_id = u.id
GROUP BY u.id, u.email, u.display_name
HAVING COUNT(o.id) >= 0
ORDER BY total_spent DESC
LIMIT 20;

UPDATE orders
SET status = 'completed'
WHERE id = 1
RETURNING id, status;
