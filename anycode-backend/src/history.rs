use crate::code::Change;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

#[derive(Serialize, Deserialize, Clone)]
pub struct History {
    pub index: usize,
    pub max_items: usize,
    pub changes: VecDeque<Change>,
}

impl History {
    pub fn new(max_items: usize) -> Self {
        Self {
            index: 0,
            max_items,
            changes: VecDeque::new(),
        }
    }

    pub fn push(&mut self, batch: Change) {
        while self.changes.len() > self.index {
            self.changes.pop_back();
        }

        if self.changes.len() == self.max_items {
            self.changes.pop_front();
            self.index -= 1;
        }

        self.changes.push_back(batch);
        self.index += 1;
    }

    pub fn undo(&mut self) -> Option<Change> {
        if self.index == 0 {
            None
        } else {
            self.index -= 1;
            self.changes.get(self.index).cloned()
        }
    }

    pub fn redo(&mut self) -> Option<Change> {
        if self.index >= self.changes.len() {
            None
        } else {
            let batch = self.changes.get(self.index).cloned();
            self.index += 1;
            batch
        }
    }
}
