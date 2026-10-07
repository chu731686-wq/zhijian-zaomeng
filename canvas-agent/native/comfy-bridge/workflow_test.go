package main

import "testing"

func TestWorkflowFieldsKeepOriginalBridgeExecution(t *testing.T) {
	workflow := jsonMap{
		"1": jsonMap{"class_type": "LoadImage", "inputs": jsonMap{"image": "old.png"}},
		"2": jsonMap{"class_type": "KSampler", "inputs": jsonMap{"image": []any{"1", float64(0)}, "steps": float64(20)}},
		"3": jsonMap{"class_type": "CLIPTextEncode", "inputs": jsonMap{"text": "old"}},
	}
	fields := []any{jsonMap{"nodeId": "1", "fieldName": "image", "source": "referenceImage", "sourceIndex": float64(0), "enabled": true}, jsonMap{"nodeId": "2", "fieldName": "steps", "source": "count", "enabled": true}}
	payload := jsonMap{"workflowFields": fields, "referenceImages": []any{}, "workflowOverrides": []any{jsonMap{"nodeId": "2", "fieldName": "steps", "value": float64(5)}}}
	if err := validateWorkflowMediaInputs(fields, payload); err != nil {
		t.Fatal(err)
	}
	if err := applyWorkflowFields(workflow, payload, map[string]string{}); err != nil {
		t.Fatal(err)
	}
	if _, exists := workflow["1"]; exists {
		t.Fatal("缺失的可选素材节点未删除")
	}
	inputs := workflow["2"].(jsonMap)["inputs"].(jsonMap)
	if _, exists := inputs["image"]; exists {
		t.Fatal("已删除素材节点的连接未清理")
	}
	if inputs["steps"] != float64(5) {
		t.Fatalf("工作流业务字段未传入：%#v", workflow)
	}
}
