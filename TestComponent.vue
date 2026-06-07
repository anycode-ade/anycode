<template>
  <main class="counter">
    <h1>{{ title }}</h1>

    <button
      class="counter__button"
      :disabled="count >= limit"
      @click="increment"
    >
      Count: {{ count }}
    </button>

    <p v-if="count >= limit" class="counter__message">
      Limit reached
    </p>

    <ul>
      <li v-for="item in history" :key="item">
        {{ item }}
      </li>
    </ul>
  </main>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";

const limit = 5;
const count = ref<number>(0);
const history = ref<number[]>([]);

const title = computed(() => `Vue counter: ${count.value}/${limit}`);

function increment(): void {
  if (count.value >= limit) return;

  count.value += 1;
  history.value.push(count.value);
}
</script>

<style scoped>
.counter {
  display: grid;
  gap: 12px;
  max-width: 420px;
  padding: 24px;
}

.counter__button {
  color: white;
  background: #42b883;
  border: 0;
  border-radius: 6px;
  padding: 10px 16px;
}

.counter__button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.counter__message {
  color: #e06c75;
}
</style>
