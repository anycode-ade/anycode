<!doctype html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title><?= htmlspecialchars($title ?? 'PHP Highlight Test') ?></title>
</head>
<body>
<?php

declare(strict_types=1);

final class Greeter
{
    public function greet(string $name, bool $excited = false): string
    {
        $message = "Hello, {$name}";

        return $excited ? $message . '!' : $message;
    }
}

$greeter = new Greeter();
$users = ['Alice', 'Bob', 'Charlie'];

?>

<h1>PHP Highlight Test</h1>

<ul class="users">
    <?php foreach ($users as $index => $user): ?>
        <li data-index="<?= $index ?>">
            <?= htmlspecialchars($greeter->greet($user, $index === 0)) ?>
        </li>
    <?php endforeach; ?>
</ul>
</body>
</html>
