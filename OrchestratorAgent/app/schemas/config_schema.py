from enum import Enum


class JobType(str, Enum):
    summarise = "summarise"
    transcribe = "transcribe"

class Action(str, Enum):
    soap = "soap"
    prescription = "prescription"