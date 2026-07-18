from app.memory.brand_store import store, recall

class MemoryAgent:
    def update(self, brand_id, constraints):
        store(brand_id, constraints)

    def recall(self, brand_id):
        return recall(brand_id)