use super::*;

#[test]
fn test_find_local_paths() {
    let temp_dir = std::env::temp_dir();
    let temp_file = temp_dir.join("test_file_anycode.txt");
    std::fs::write(&temp_file, "hello").unwrap();

    let prompt = format!("Please look at file://{} and write code", temp_file.display());
    let paths = find_local_paths(&prompt);
    assert!(paths.contains(&temp_file));

    // Test non-ASCII input (Cyrillic 'с' like in the user's report)
    let prompt_cyrillic = format!("Привет, вот файл: file://{} с текстом", temp_file.display());
    let paths_cyrillic = find_local_paths(&prompt_cyrillic);
    assert!(paths_cyrillic.contains(&temp_file));

    let _ = std::fs::remove_file(temp_file);
}

#[tokio::test]
async fn test_acp_agent_queue_operations() {
    let temp_dir = tempfile::tempdir().unwrap();
    let (fs_tx, _fs_rx) = tokio::sync::mpsc::channel(1);
    let agent = crate::acp::AcpAgent::new_with_project_root(
        "test-agent".to_string(),
        "Test Agent".to_string(),
        temp_dir.path().to_path_buf(),
        fs_tx,
    );

    assert_eq!(agent.get_queue().await.len(), 0);

    // Enqueue items
    let id1 = agent.enqueue_prompt("First prompt".to_string(), vec![]).await;
    let id2 = agent.enqueue_prompt("Second prompt".to_string(), vec![]).await;
    let id3 = agent.enqueue_prompt("Third prompt".to_string(), vec![]).await;

    let queue = agent.get_queue().await;
    assert_eq!(queue.len(), 3);
    assert_eq!(queue[0].id, id1);
    assert_eq!(queue[0].prompt, "First prompt");
    assert_eq!(queue[1].id, id2);
    assert_eq!(queue[2].id, id3);

    // Update item
    let updated = agent.update_queued_prompt(&id2, "Updated second prompt".to_string()).await;
    assert!(updated);
    let queue = agent.get_queue().await;
    assert_eq!(queue[1].prompt, "Updated second prompt");

    // Move up
    let moved_up = agent.move_queued_prompt(&id2, "up").await;
    assert!(moved_up);
    let queue = agent.get_queue().await;
    assert_eq!(queue[0].id, id2);
    assert_eq!(queue[1].id, id1);

    // Move down
    let moved_down = agent.move_queued_prompt(&id2, "down").await;
    assert!(moved_down);
    let queue = agent.get_queue().await;
    assert_eq!(queue[0].id, id1);
    assert_eq!(queue[1].id, id2);

    // Boundary tests
    // Move first item up should return false (already at top)
    let moved_top_up = agent.move_queued_prompt(&id1, "up").await;
    assert!(!moved_top_up);

    // Move last item down should return false (already at bottom)
    let moved_bottom_down = agent.move_queued_prompt(&id3, "down").await;
    assert!(!moved_bottom_down);

    // Move non-existent item should return false
    let moved_non_existent = agent.move_queued_prompt("non-existent-id", "up").await;
    assert!(!moved_non_existent);

    // Move with unknown direction should return false
    let moved_invalid_dir = agent.move_queued_prompt(&id1, "invalid_direction").await;
    assert!(!moved_invalid_dir);

    // Update non-existent item should return false
    let updated_non_existent = agent.update_queued_prompt("non-existent-id", "some prompt".to_string()).await;
    assert!(!updated_non_existent);

    // Remove non-existent item should return false
    let removed_non_existent = agent.remove_queued_prompt("non-existent-id").await;
    assert!(!removed_non_existent);

    // Remove item
    let removed = agent.remove_queued_prompt(&id2).await;
    assert!(removed);
    let queue = agent.get_queue().await;
    assert_eq!(queue.len(), 2);
    assert_eq!(queue[0].id, id1);
    assert_eq!(queue[1].id, id3);

    // Clear queue
    agent.clear_queue().await;
    assert_eq!(agent.get_queue().await.len(), 0);

    // Clear again (idempotent)
    agent.clear_queue().await;
    assert_eq!(agent.get_queue().await.len(), 0);
}

#[tokio::test]
async fn test_idle_prompt_does_not_broadcast_queue_update_but_busy_does() {
    let temp_dir = tempfile::tempdir().unwrap();
    let (fs_tx, _fs_rx) = tokio::sync::mpsc::channel(1);
    let mut agent = crate::acp::AcpAgent::new_with_project_root(
        "test-agent".to_string(),
        "Test Agent".to_string(),
        temp_dir.path().to_path_buf(),
        fs_tx,
    );

    let mut rx = agent.init_message_sender_for_test();

    // Verify agent is currently idle
    assert!(!agent.is_processing());

    // 1. Enqueue prompt while idle -> should NOT broadcast QueueUpdate (prevents UI flicker)
    let id1 = agent.enqueue_prompt("Hello idle".to_string(), vec![]).await;
    assert!(rx.try_recv().is_err(), "Idle prompt should not broadcast QueueUpdate");

    // Queue still contains the item internally
    assert_eq!(agent.get_queue().await.len(), 1);

    // 2. Enqueue second prompt while first is pending in queue -> SHOULD broadcast QueueUpdate
    let id2 = agent.enqueue_prompt("Second prompt".to_string(), vec![]).await;
    let msg = rx.try_recv().expect("Second prompt should broadcast QueueUpdate");
    match msg {
        crate::acp::AcpMessage::QueueUpdate(update) => {
            assert_eq!(update.queue.len(), 2);
            assert_eq!(update.queue[0].id, id1);
            assert_eq!(update.queue[1].id, id2);
        }
        other => panic!("Expected QueueUpdate, got {:?}", other),
    }
}
