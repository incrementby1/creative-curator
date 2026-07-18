_memory = {}

def store(brand_id, data):
    _memory.setdefault(brand_id, []).append(data)

def recall(brand_id):
    return _memory.get(brand_id, [])